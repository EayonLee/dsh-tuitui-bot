/**
 * 自更新：下载 → 校验 → 备份 → 安装 → （宿主侧热重载）
 *
 * 为什么不用宿主现成的 pluginManager.installBundle：
 *   · 本机 profile 挂了 dsh-hmr 时，installBundle 对「已经是依赖」的包直接抛
 *     already-installed —— 更新永远走不通；
 *   · 它按 spec 判断包身份，tarball 场景本来就容易判不出来。
 * 所以这里走 pnpm 原生安装 + 宿主自己的热重载通道（hmr.reconcileProfile），
 * 每一步都能回滚。
 *
 * 失败一律回滚到更新前的目录，并如实返回错误 —— 不允许出现"看起来成功了、
 * 其实装了一半"的状态。
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

/** 单次下载体积上限：正式包 3MB 左右，50MB 足够挡住乱来 */
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

/** pnpm 安装超时：180 秒（走代理时也要够） */
export const PNPM_TIMEOUT_MS = 180 * 1000;

/**
 * 更新包的持久缓存目录（相对 profile 根）。
 *
 * 自更新下载到 os.tmpdir() 的临时目录，装完就删；如果直接把 `file:<临时路径>`
 * 写进 profile 的 package.json，依赖就会指向一个已经不存在的位置，之后这个
 * profile 里任何 `pnpm install` / `dsh plugin add` 都会 ENOENT（#36）。
 * 所以安装前把 tarball 落到 profile 内的稳定路径，只留当前版本这一份。
 */
export const UPDATE_CACHE_DIRNAME = '.dsh-tuitui-updates';

/** 把下载好的 tarball 复制到 profile 内的稳定缓存，返回稳定路径 */
export async function persistTarball(profileDir: string, downloadedPath: string): Promise<string> {
  const cacheDir = join(profileDir, UPDATE_CACHE_DIRNAME);
  await mkdir(cacheDir, { recursive: true });
  const target = join(cacheDir, basename(downloadedPath));
  await copyFile(downloadedPath, target);
  // 旧版本 tgz 留在 profile 里只会占地方：只保留刚装这一份
  try {
    for (const entry of await readdir(cacheDir)) {
      if (entry !== basename(target) && entry.endsWith('.tgz')) {
        await rm(join(cacheDir, entry), { force: true }).catch(() => {});
      }
    }
  } catch {
    // 清理失败不影响安装
  }
  return target;
}

/** 已安装包的信息（磁盘真值） */
export interface InstalledPackage {
  name: string;
  version: string;
  /** 包根目录 */
  dir: string;
}

/** 包根目录：lib/setup/self-update.js 与 src/setup/self-update.ts 都是上两级 */
function packageRootUrl(): URL {
  return new URL('../../', import.meta.url);
}

/** 读指定目录里的 package.json 版本（更新前后校验用） */
export async function readVersionAt(dir: string): Promise<string> {
  const text = await readFile(join(dir, 'package.json'), 'utf8');
  const manifest = JSON.parse(text) as { version?: unknown };
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error('目录里的 package.json 没有 version：' + dir);
  }
  return manifest.version;
}

/** 读已安装的 package.json；读不到抛错（调用方决定降级文案） */
export async function readInstalledPackage(): Promise<InstalledPackage> {
  const url = new URL('package.json', packageRootUrl());
  const text = await readFile(url, 'utf8');
  const manifest = JSON.parse(text) as { name?: unknown; version?: unknown };
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error('安装包的 package.json 缺少 name/version');
  }
  return { name: manifest.name, version: manifest.version, dir: new URL('.', url).pathname };
}

/** 包清单（只看更新要用的字段） */
export interface PackageManifest {
  name?: string;
  version?: string;
  dsh?: {
    compatibility?: {
      dshReleases?: Record<string, string>;
      note?: string;
    };
  };
}

/** 从 tar 头里读以 NUL 结尾的字符串字段 */
function readTarString(buffer: Uint8Array, start: number, length: number): string {
  const slice = buffer.subarray(start, start + length);
  let end = slice.indexOf(0);
  if (end < 0) end = slice.length;
  return new TextDecoder().decode(slice.subarray(0, end)).trim();
}

/**
 * 从 .tgz 里直接读 package.json。
 *
 * 为什么不用再请求一次 GitHub raw：那样会多一次网络往返和一层 CDN 缓存，
 * 而且拿到的未必是用户即将安装的那个字节。包里有什么，就看什么。
 */
export function readManifestFromTarball(buffer: Uint8Array): PackageManifest {
  const tar = gunzipSync(buffer);
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const size = Number.parseInt(readTarString(header, 124, 12), 8) || 0;
    const dataStart = offset + 512;
    const full = prefix === '' ? name : prefix + '/' + name;
    if (full === 'package/package.json' || full === 'package.json') {
      const text = new TextDecoder().decode(tar.subarray(dataStart, dataStart + size));
      return JSON.parse(text) as PackageManifest;
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error('安装包里找不到 package.json');
}

/**
 * 当前宿主 dsh 的版本。
 *
 * 插件跑在宿主进程里，但 peer 依赖在 pnpm 隔离下解析不到，所以从
 * process.argv[1]（真正的 dsh 可执行入口）往上找 name='@deepseek-ai/dsh' 的 package.json。
 * 取不到就返回 null —— 调用方据此跳过兼容校验，而不是瞎猜一个版本。
 */
export function readHostVersion(): string | null {
  const entry = process.argv[1];
  if (typeof entry !== 'string' || entry === '') return null;
  let dir: string;
  try {
    dir = dirname(realpathSync(entry));
  } catch {
    return null;
  }
  for (let depth = 0; depth < 8; depth += 1) {
    const manifestPath = join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown; version?: unknown };
        if (manifest.name === '@deepseek-ai/dsh' && typeof manifest.version === 'string') return manifest.version;
      } catch {
        // 坏 JSON 继续往上找
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 兼容性判定结果 */
export interface CompatibilityVerdict {
  /** 是否真的做了判定（false = 信息不足，放行但要在文案里说清） */
  checked: boolean;
  ok: boolean;
  message: string;
}

/**
 * 宿主兼容性校验：目标包的 `dsh.compatibility.dshReleases` 必须认可当前宿主版本。
 *
 * 这条是本仓库自己声明的契约：写了「0.2.1-rc.5: compatible」，就表示宿主大版本
 * 升级后要重新验收。所以：
 *   · 显式 compatible → 放行
 *   · 显式其它状态（incompatible / untested…）→ 拒绝
 *   · 列表里没有当前宿主 → 拒绝（没验证过就是没验证过）
 *   · 取不到宿主版本 / 目标没声明 → 放行，但在结果里注明"跳过校验"
 */
export function checkCompatibility(manifest: PackageManifest, hostVersion: string | null): CompatibilityVerdict {
  const releases = manifest.dsh?.compatibility?.dshReleases;
  if (typeof releases !== 'object' || releases === null || Array.isArray(releases)) {
    return { checked: false, ok: true, message: '目标版本没有声明 dsh 兼容范围，已跳过兼容校验' };
  }
  const supported = Object.keys(releases);
  if (hostVersion === null) {
    return {
      checked: false,
      ok: true,
      message: '取不到宿主版本，已跳过兼容校验（目标声明支持：' + supported.join(' / ') + '）',
    };
  }
  const status = releases[hostVersion];
  if (status === 'compatible') {
    return { checked: true, ok: true, message: '宿主 ' + hostVersion + ' 在兼容列表内' };
  }
  if (typeof status === 'string') {
    return { checked: true, ok: false, message: '目标版本把宿主 ' + hostVersion + ' 标为「' + status + '」，已拒绝更新' };
  }
  return {
    checked: true,
    ok: false,
    message: '目标版本没验证过宿主 ' + hostVersion + '（声明支持：' + supported.join(' / ') + '），已拒绝更新',
  };
}

/** 一个可执行的更新计划 */
export interface UpdatePlan {
  /** 目标版本 */
  version: string;
  /** 传给 pnpm add 的 spec（tarball 路径 / github:owner/repo） */
  spec: string;
  /** 下载地址（仅 release 通道） */
  downloadUrl?: string;
  /** GitHub 给的 sha256（形如 sha256:xxxx），没有就不校验 */
  digest?: string;
  /** 展示用的来源标签 */
  label: string;
}

/** GitHub Release 的形状（只取用得到的字段） */
interface ReleasePayload {
  tag_name?: unknown;
  assets?: unknown;
}

/** Release asset 的形状 */
interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
  digest?: string;
}

/**
 * 从 Release 里挑正式包。
 *
 * 只认 `dsh-tuitui-bot-<版本>.tgz` 这一种命名：把「装什么」限制死，
 * 是自更新这类动作最基本的安全边界（绝不接受任意 URL）。
 */
export function pickReleaseAsset(
  release: unknown,
  version: string,
): ReleaseAsset | null {
  if (typeof release !== 'object' || release === null) return null;
  const assets = (release as ReleasePayload).assets;
  if (!Array.isArray(assets)) return null;
  const wanted = 'dsh-tuitui-bot-' + version + '.tgz';
  for (const item of assets) {
    if (typeof item !== 'object' || item === null) continue;
    const asset = item as Partial<ReleaseAsset>;
    if (typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') continue;
    if (asset.name !== wanted) continue;
    return {
      name: asset.name,
      browser_download_url: asset.browser_download_url,
      ...(typeof asset.size === 'number' ? { size: asset.size } : {}),
      ...(typeof asset.digest === 'string' ? { digest: asset.digest } : {}),
    };
  }
  return null;
}

/** 从 Release 响应里取 tag（去掉 v） */
export function releaseVersion(release: unknown): string | null {
  if (typeof release !== 'object' || release === null) return null;
  const tag = (release as ReleasePayload).tag_name;
  if (typeof tag !== 'string' || tag.trim() === '') return null;
  return tag.trim().replace(/^v/i, '');
}

/** 注入的 fetch（与 version-check 同形状） */
export interface FetchLike {
  (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }): Promise<{
    ok: boolean;
    status: number;
    arrayBuffer(): Promise<ArrayBuffer>;
    json(): Promise<unknown>;
  }>;
}

/**
 * 生成更新计划。
 *
 * release 通道：查 releases/latest → 校验版本 → 找同名 asset；
 * main 通道：直接按 github:owner/repo 装主干（没有 asset 可下）。
 */
export async function planUpdate(options: {
  slug: string;
  channel: 'release' | 'main';
  fetchImpl: FetchLike;
  /** 已知的最新版本（已由 version-check 得出）；release 通道用它核对 asset */
  latestVersion: string;
  timeoutMs?: number;
}): Promise<UpdatePlan> {
  const { slug, channel, fetchImpl, latestVersion } = options;
  if (channel === 'main') {
    return { version: latestVersion, spec: 'github:' + slug, label: 'GitHub 主干' };
  }
  // 版本号既然已经由 version-check 得出（可能来自 atom，绕过了 API 限流），
  // 下载地址就是确定的：Release 资产的命名规则是死的。
  // API 被限流或超时时走这条路，别让用户「看得到新版却点不动」。
  const directPlan = (): UpdatePlan => {
    const url = 'https://github.com/' + slug + '/releases/download/v' + latestVersion
      + '/dsh-tuitui-bot-' + latestVersion + '.tgz';
    return { version: latestVersion, spec: url, downloadUrl: url, label: 'GitHub Release（直链）' };
  };
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, options.timeoutMs ?? 8000);
  try {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetchImpl('https://api.github.com/repos/' + slug + '/releases/latest', {
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': 'dsh-tuitui-bot-self-update' },
      });
    } catch {
      // 断网 / 超时 / DNS 挂：版本号已经知道，直链照样能装
      return directPlan();
    }
    if (!response.ok) return directPlan();
    const release = await response.json().catch(() => null);
    if (release === null || typeof release !== 'object') return directPlan();
    const version = releaseVersion(release) ?? latestVersion;
    const asset = pickReleaseAsset(release, version);
    if (asset === null) throw new Error('Release 里没有 ' + 'dsh-tuitui-bot-' + version + '.tgz');
    return {
      version,
      spec: asset.browser_download_url,
      downloadUrl: asset.browser_download_url,
      ...(asset.digest === undefined ? {} : { digest: asset.digest }),
      label: 'GitHub Release',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 计算文件的 sha256（十六进制） */
export function sha256(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** 下载到临时目录并校验大小/摘要，返回本地路径 */
export async function downloadPlan(
  plan: UpdatePlan,
  fetchImpl: FetchLike,
  dir: string,
  timeoutMs = 60000,
): Promise<{ path: string; bytes: number; sha256: string }> {
  if (plan.downloadUrl === undefined) throw new Error('该更新计划没有下载地址');
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  try {
    const response = await fetchImpl(plan.downloadUrl, {
      signal: controller.signal,
      headers: { accept: 'application/octet-stream', 'user-agent': 'dsh-tuitui-bot-self-update' },
    });
    if (!response.ok) throw new Error('下载失败：HTTP ' + String(response.status));
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength === 0) throw new Error('下载到 0 字节');
    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error('包过大（' + String(buffer.byteLength) + ' 字节），已拒绝');
    }
    const digest = sha256(buffer);
    if (plan.digest !== undefined && plan.digest.trim() !== '') {
      const expected = plan.digest.trim().replace(/^sha256:/i, '').toLowerCase();
      if (expected !== digest) {
        throw new Error('sha256 不匹配（期望 ' + expected.slice(0, 12) + '…，实际 ' + digest.slice(0, 12) + '…）');
      }
    }
    const filename = plan.downloadUrl.split('/').pop() ?? 'dsh-tuitui-bot.tgz';
    const path = join(dir, filename.replace(/[^\w.@-]/g, '_'));
    await mkdir(dir, { recursive: true });
    await import('node:fs/promises').then((fs) => fs.writeFile(path, buffer));
    return { path, bytes: buffer.byteLength, sha256: digest };
  } finally {
    clearTimeout(timer);
  }
}

/** pnpm 是否可用 */
export function hasPnpm(command = 'pnpm'): boolean {
  const dirs = (process.env.PATH ?? '').split(':');
  for (const dir of dirs) {
    if (dir !== '' && existsSync(join(dir, command))) return true;
  }
  return false;
}

/** pnpm add 的执行结果 */
export interface PnpmResult {
  ok: boolean;
  code: number | null;
  output: string;
}

/** 在 profile 目录执行 pnpm add <spec> --save-exact */
export async function runPnpmAdd(options: {
  profileDir: string;
  spec: string;
  command?: string;
  timeoutMs?: number;
}): Promise<PnpmResult> {
  const command = options.command ?? 'pnpm';
  return await new Promise<PnpmResult>((resolve) => {
    const child = spawn(command, ['add', options.spec, '--save-exact'], {
      cwd: options.profileDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => {
      output += '\n[超时] pnpm 超过 ' + String(options.timeoutMs ?? PNPM_TIMEOUT_MS) + 'ms 未结束，已终止';
      child.kill('SIGKILL');
    }, options.timeoutMs ?? PNPM_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, output: output + '\n' + err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, output });
    });
  });
}

/** 读 profile 的 package.json（形如 { dsh: { profile: { bundles: [] } }, dependencies: {} }） */
export async function readProfileManifest(profileDir: string): Promise<{
  dependencies: Record<string, string>;
  bundles: string[];
  raw: Record<string, unknown>;
}> {
  const text = await readFile(join(profileDir, 'package.json'), 'utf8');
  const raw = JSON.parse(text) as Record<string, unknown>;
  const deps = (raw.dependencies ?? {}) as Record<string, string>;
  const dsh = (raw.dsh ?? {}) as { profile?: { bundles?: unknown } };
  const bundlesRaw = dsh.profile?.bundles;
  const bundles = Array.isArray(bundlesRaw) ? bundlesRaw.filter((item): item is string => typeof item === 'string') : [];
  return { dependencies: deps, bundles, raw };
}

/**
 * 确保包在 profile 的 dsh.profile.bundles 里。
 *
 * 这是 0.1.30 那次「重装后插件整个消失」的根因：依赖装上了、bundles 里没有，
 * 于是 bundle patch 从不加载，cordis 里那条 patch 变成孤儿。
 */
export async function ensureBundleListed(profileDir: string, name: string): Promise<void> {
  const manifest = await readProfileManifest(profileDir);
  if (manifest.bundles.includes(name)) return;
  const raw = manifest.raw as { dsh?: { profile?: { bundles?: string[] } } };
  raw.dsh ??= {};
  raw.dsh.profile ??= {};
  raw.dsh.profile.bundles = [...manifest.bundles, name];
  await import('node:fs/promises').then((fs) =>
    fs.writeFile(join(profileDir, 'package.json'), JSON.stringify(raw, null, 2) + '\n'),
  );
}

/** 备份/还原的目录对 */
export interface Backup {
  dir: string;
  backup: string;
}

/** 把已安装目录整体复制到备份位置 */
export async function backupPackage(installedDir: string, backupDir: string): Promise<Backup> {
  await mkdir(backupDir, { recursive: true });
  await cp(installedDir, backupDir, { recursive: true });
  return { dir: installedDir, backup: backupDir };
}

/** 用备份覆盖回去（装坏了就还原） */
export async function restorePackage(backup: Backup): Promise<void> {
  await rm(backup.dir, { recursive: true, force: true });
  await cp(backup.backup, backup.dir, { recursive: true });
}

/** 更新过程依赖（单测注入用） */
export interface UpdateDeps {
  fetchImpl: FetchLike;
  profileDir: string;
  /** 包名（bundles 校验用） */
  packageName: string;
  /** pnpm 可执行文件 */
  pnpmCommand?: string;
  /** 临时目录根（默认系统 tmp） */
  tempRoot?: string;
  /** 宿主版本（默认自己探测；单测注入） */
  hostVersion?: string | null;
  logger?: { info(message: string): void; warn(message: string): void };
}

/**
 * 当前是不是「开发软链」安装。
 *
 * profile 用 `link:` 指到源码目录时，node_modules 里是软链，pnpm add 会把开发流
 * 直接换成一份打包产物 —— 那是灾难。遇到就直接拒绝并让人手动处理。
 */
export async function assertMutableInstall(profileDir: string, packageName: string): Promise<void> {
  const manifest = await readProfileManifest(profileDir);
  const spec = manifest.dependencies[packageName] ?? '';
  if (spec.startsWith('link:')) {
    throw new Error('当前是开发软链安装（' + spec + '），自动更新会覆盖源码链接，已拒绝');
  }
}

/** 更新结果 */
export interface UpdateOutcome {
  ok: boolean;
  from: string;
  to: string | null;
  error?: string;
  detail?: string;
}

/**
 * 执行更新（不含热重载 —— 重载由路由层在本请求返回之后触发）。
 *
 * 步骤：备份 → pnpm add → 校验版本 → 补 bundles；任一步失败就还原并返回错误。
 */
export async function applyUpdate(options: {
  plan: UpdatePlan;
  installed: InstalledPackage;
  deps: UpdateDeps;
}): Promise<UpdateOutcome> {
  const { plan, installed, deps } = options;
  const log = deps.logger;
  const tempRoot = await mkdtemp(join(deps.tempRoot ?? tmpdir(), 'dsh-tuitui-update-'));
  let backup: Backup | null = null;
  let spec = plan.spec;
  let compatNote = '';
  try {
    await assertMutableInstall(deps.profileDir, deps.packageName);
    if (plan.downloadUrl !== undefined) {
      const downloaded = await downloadPlan(plan, deps.fetchImpl, tempRoot);
      log?.info('自更新：下载完成 ' + String(downloaded.bytes) + ' 字节，sha256=' + downloaded.sha256.slice(0, 12) + '…');
      // 安装前先看包里到底装了什么：名字、版本、兼容范围
      const buffer = await readFile(downloaded.path);
      const manifest = readManifestFromTarball(buffer);
      if (manifest.name !== deps.packageName) {
        throw new Error('包名不符（期望 ' + deps.packageName + '，实际 ' + String(manifest.name) + '），已拒绝');
      }
      if (manifest.version !== plan.version) {
        throw new Error('包里版本不符（期望 ' + plan.version + '，实际 ' + String(manifest.version) + '），已拒绝');
      }
      const hostVersion = deps.hostVersion === undefined ? readHostVersion() : deps.hostVersion;
      const verdict = checkCompatibility(manifest, hostVersion);
      if (!verdict.ok) throw new Error(verdict.message);
      compatNote = verdict.message;
      // 落到 profile 内的稳定路径：临时目录在 finally 里会被删掉（#36）
      spec = 'file:' + await persistTarball(deps.profileDir, downloaded.path);
    }
    backup = await backupPackage(installed.dir, join(tempRoot, 'backup'));
    const run = await runPnpmAdd({
      profileDir: deps.profileDir,
      spec,
      ...(deps.pnpmCommand === undefined ? {} : { command: deps.pnpmCommand }),
    });
    if (!run.ok) {
      throw new Error('pnpm add 失败（code=' + String(run.code) + '）：' + run.output.trim().slice(-400));
    }
    // 装完以磁盘为准复核版本：pnpm 的 lockfile 缓存偶尔会给出旧版本
    const afterVersion = await readVersionAt(installed.dir);
    if (afterVersion !== plan.version) {
      throw new Error('装完版本不符（期望 ' + plan.version + '，实际 ' + afterVersion + '）');
    }
    await ensureBundleListed(deps.profileDir, deps.packageName);
    return {
      ok: true,
      from: installed.version,
      to: afterVersion,
      detail: '来源：' + plan.label + '；bundles 已确认包含 ' + deps.packageName
        + (compatNote === '' ? '' : '；' + compatNote),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log?.warn('自更新失败，回滚：' + message);
    if (backup !== null) {
      try {
        await restorePackage(backup);
      } catch (restoreError) {
        const reason = restoreError instanceof Error ? restoreError.message : String(restoreError);
        return { ok: false, from: installed.version, to: null, error: message + '；回滚也失败：' + reason };
      }
    }
    return { ok: false, from: installed.version, to: null, error: message };
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/** 读文件内容（测试/诊断用） */
export function readVersionFileSync(path: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

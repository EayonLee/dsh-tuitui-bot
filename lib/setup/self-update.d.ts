/** 单次下载体积上限：正式包 3MB 左右，50MB 足够挡住乱来 */
export declare const MAX_DOWNLOAD_BYTES: number;
/** pnpm 安装超时：180 秒（走代理时也要够） */
export declare const PNPM_TIMEOUT_MS: number;
/**
 * 更新包的持久缓存目录（相对 profile 根）。
 *
 * 自更新下载到 os.tmpdir() 的临时目录，装完就删；如果直接把 `file:<临时路径>`
 * 写进 profile 的 package.json，依赖就会指向一个已经不存在的位置，之后这个
 * profile 里任何 `pnpm install` / `dsh plugin add` 都会 ENOENT（#36）。
 * 所以安装前把 tarball 落到 profile 内的稳定路径，只留当前版本这一份。
 */
export declare const UPDATE_CACHE_DIRNAME = ".dsh-tuitui-updates";
/** 把下载好的 tarball 复制到 profile 内的稳定缓存，返回稳定路径 */
export declare function persistTarball(profileDir: string, downloadedPath: string): Promise<string>;
/** 已安装包的信息（磁盘真值） */
export interface InstalledPackage {
    name: string;
    version: string;
    /** 包根目录 */
    dir: string;
}
/** 读指定目录里的 package.json 版本（更新前后校验用） */
export declare function readVersionAt(dir: string): Promise<string>;
/** 读已安装的 package.json；读不到抛错（调用方决定降级文案） */
export declare function readInstalledPackage(): Promise<InstalledPackage>;
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
/**
 * 从 .tgz 里直接读 package.json。
 *
 * 为什么不用再请求一次 GitHub raw：那样会多一次网络往返和一层 CDN 缓存，
 * 而且拿到的未必是用户即将安装的那个字节。包里有什么，就看什么。
 */
export declare function readManifestFromTarball(buffer: Uint8Array): PackageManifest;
/**
 * 当前宿主 dsh 的版本。
 *
 * 插件跑在宿主进程里，但 peer 依赖在 pnpm 隔离下解析不到，所以从
 * process.argv[1]（真正的 dsh 可执行入口）往上找 name='@deepseek-ai/dsh' 的 package.json。
 * 取不到就返回 null —— 调用方据此跳过兼容校验，而不是瞎猜一个版本。
 */
export declare function readHostVersion(): string | null;
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
export declare function checkCompatibility(manifest: PackageManifest, hostVersion: string | null): CompatibilityVerdict;
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
export declare function pickReleaseAsset(release: unknown, version: string): ReleaseAsset | null;
/** 从 Release 响应里取 tag（去掉 v） */
export declare function releaseVersion(release: unknown): string | null;
/** 注入的 fetch（与 version-check 同形状） */
export interface FetchLike {
    (url: string, init?: {
        signal?: AbortSignal;
        headers?: Record<string, string>;
    }): Promise<{
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
export declare function planUpdate(options: {
    slug: string;
    channel: 'release' | 'main';
    fetchImpl: FetchLike;
    /** 已知的最新版本（已由 version-check 得出）；release 通道用它核对 asset */
    latestVersion: string;
    timeoutMs?: number;
}): Promise<UpdatePlan>;
/** 计算文件的 sha256（十六进制） */
export declare function sha256(buffer: Uint8Array): string;
/** 下载到临时目录并校验大小/摘要，返回本地路径 */
export declare function downloadPlan(plan: UpdatePlan, fetchImpl: FetchLike, dir: string, timeoutMs?: number): Promise<{
    path: string;
    bytes: number;
    sha256: string;
}>;
/** pnpm 是否可用 */
export declare function hasPnpm(command?: string): boolean;
/** pnpm add 的执行结果 */
export interface PnpmResult {
    ok: boolean;
    code: number | null;
    output: string;
}
/** 在 profile 目录执行 pnpm add <spec> --save-exact */
export declare function runPnpmAdd(options: {
    profileDir: string;
    spec: string;
    command?: string;
    timeoutMs?: number;
}): Promise<PnpmResult>;
/** 读 profile 的 package.json（形如 { dsh: { profile: { bundles: [] } }, dependencies: {} }） */
export declare function readProfileManifest(profileDir: string): Promise<{
    dependencies: Record<string, string>;
    bundles: string[];
    raw: Record<string, unknown>;
}>;
/**
 * 确保包在 profile 的 dsh.profile.bundles 里。
 *
 * 这是 0.1.30 那次「重装后插件整个消失」的根因：依赖装上了、bundles 里没有，
 * 于是 bundle patch 从不加载，cordis 里那条 patch 变成孤儿。
 */
export declare function ensureBundleListed(profileDir: string, name: string): Promise<void>;
/** 备份/还原的目录对 */
export interface Backup {
    dir: string;
    backup: string;
}
/** 把已安装目录整体复制到备份位置 */
export declare function backupPackage(installedDir: string, backupDir: string): Promise<Backup>;
/** 用备份覆盖回去（装坏了就还原） */
export declare function restorePackage(backup: Backup): Promise<void>;
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
    logger?: {
        info(message: string): void;
        warn(message: string): void;
    };
}
/**
 * 当前是不是「开发软链」安装。
 *
 * profile 用 `link:` 指到源码目录时，node_modules 里是软链，pnpm add 会把开发流
 * 直接换成一份打包产物 —— 那是灾难。遇到就直接拒绝并让人手动处理。
 */
export declare function assertMutableInstall(profileDir: string, packageName: string): Promise<void>;
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
export declare function applyUpdate(options: {
    plan: UpdatePlan;
    installed: InstalledPackage;
    deps: UpdateDeps;
}): Promise<UpdateOutcome>;
/** 读文件内容（测试/诊断用） */
export declare function readVersionFileSync(path: string): string | null;
export {};
//# sourceMappingURL=self-update.d.ts.map
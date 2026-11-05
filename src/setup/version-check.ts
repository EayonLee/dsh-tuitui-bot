/**
 * 版本比较与「线上最新是哪一版」的查询
 *
 * 设计取自 dsh-speak-up/lib/selfupdate.mjs 的实战经验，并改掉它的一个老毛病：
 *   · 多源全查、取最大的那个 —— 谁先返回用谁会在 GitHub 超时时落到 jsDelivr 的
 *     CDN 缓存上，同一分钟能报出两个不同的"最新"，甚至比本机还旧
 *   · 查不到就如实说查不到，绝不显示成"已是最新"
 *   · 结果带缓存；点按钮（refresh）才绕过缓存
 *
 * 纯函数 + 注入 fetch，方便单测在无网络环境下跑。
 */
import type { UpdateChannel } from '../shared/about-protocol.ts';

/** 一次版本号的解析结果 */
export interface ParsedVersion {
  /** 主版本三元组 */
  nums: [number, number, number];
  /** 预发布标记（1.2.3-beta.1 的 beta.1），正式版为空串 */
  prerelease: string;
}

/** 缓存时间：6 小时（GitHub 未认证限流 60 次/小时，缓存不是优化是必需） */
export const CHECK_TTL_MS = 6 * 60 * 60 * 1000;

/** 单源超时：8 秒。慢的源不该拖住整个检查 */
export const CHECK_TIMEOUT_MS = 8000;

/**
 * 解析版本号。认 1.2.3 / v1.2.3 / 1.2.3-beta.1 三种写法。
 *
 * 不认就直接返回 0.0.0：宁可判成"很旧"，也不要抛错把整个检查打挂。
 */
export function parseVersion(raw: string): ParsedVersion {
  const text = String(raw ?? '').trim().replace(/^v/i, '');
  const cut = text.indexOf('-');
  const core = cut >= 0 ? text.slice(0, cut) : text;
  const prerelease = cut >= 0 ? text.slice(cut + 1) : '';
  const parts = core.split('.');
  const nums: [number, number, number] = [
    Number.parseInt(parts[0] ?? '', 10) || 0,
    Number.parseInt(parts[1] ?? '', 10) || 0,
    Number.parseInt(parts[2] ?? '', 10) || 0,
  ];
  return { nums, prerelease };
}

/** 比较两个版本号：a>b 返回 1，a<b 返回 -1，相等 0 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    const l = left.nums[i] ?? 0;
    const r = right.nums[i] ?? 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  if (left.prerelease === right.prerelease) return 0;
  // 正式版比任何预发布都新
  if (left.prerelease === '') return 1;
  if (right.prerelease === '') return -1;
  return left.prerelease > right.prerelease ? 1 : -1;
}

/** candidate 是否比 current 新 */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

/** 一个版本源 */
export interface VersionSource {
  /** 要请求的地址 */
  url: string;
  /** 展示给人看的来源名 */
  label: string;
  /** 从响应里取出未加工的版本字符串；取不到返回 null */
  parse: (payload: unknown) => string | null;
}

/** 从 package.json 形状的对象里取 version */
function versionFromManifest(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const version = (payload as { version?: unknown }).version;
  return typeof version === 'string' && version.trim() !== '' ? version.trim() : null;
}

/** 从 GitHub releases/latest 响应里取 tag_name */
function versionFromRelease(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const tag = (payload as { tag_name?: unknown }).tag_name;
  if (typeof tag !== 'string' || tag.trim() === '') return null;
  return tag.trim().replace(/^v/i, '');
}

/**
 * 列出要查的源。
 *
 * release 通道以 GitHub Release 为准（那是用户真正能下载的包）；
 * main 通道看主干 package.json（raw 优先、jsDelivr 兜底，后者有 CDN 缓存，
 * 所以必须取最大而不是先到先得）。
 *
 * 两个通道都带一个"降级源"：API 挂了还能给出一个上限参考，并在 source 里
 * 如实标注，不让用户以为那就是正式发布。
 */
export function buildSources(slug: string, channel: UpdateChannel): VersionSource[] {
  const release: VersionSource = {
    url: 'https://api.github.com/repos/' + slug + '/releases/latest',
    label: 'GitHub Release',
    parse: versionFromRelease,
  };
  const mainRaw: VersionSource = {
    url: 'https://raw.githubusercontent.com/' + slug + '/HEAD/package.json',
    label: 'GitHub 主干',
    parse: versionFromManifest,
  };
  const mainCdn: VersionSource = {
    url: 'https://cdn.jsdelivr.net/gh/' + slug + '@main/package.json',
    label: 'jsDelivr',
    parse: versionFromManifest,
  };
  return channel === 'release'
    ? [release, mainRaw]
    : [mainRaw, mainCdn, release];
}

/** 单个源的查询结果 */
interface SourceOutcome {
  label: string;
  version: string | null;
  error: string | null;
}

/** 查询结果 */
export interface LatestLookup {
  /** 线上最新版本；一个源都没成功时为 null */
  latest: string | null;
  /** 提供该版本的源名 */
  source: string | null;
  /** 失败说明（多源全挂时才填） */
  error: string | null;
}

/** 注入的 fetch（默认全局 fetch） */
export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

async function readSource(source: VersionSource, fetchImpl: FetchLike, timeoutMs: number): Promise<SourceOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  try {
    const response = await fetchImpl(source.url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'dsh-tuitui-bot-version-check',
      },
    });
    if (!response.ok) {
      return { label: source.label, version: null, error: 'HTTP ' + String(response.status) };
    }
    // Release 是 JSON；raw/jsDelivr 也是 JSON；都用 json()，解析失败再看文本
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      const text = await response.text();
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        return { label: source.label, version: null, error: '响应不是 JSON' };
      }
    }
    const version = source.parse(payload);
    return { label: source.label, version, error: version === null ? '响应里没有版本号' : null };
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? '超时' : (err instanceof Error ? err.message : String(err));
    return { label: source.label, version: null, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 并发查所有源，取最大版本。
 *
 * 全部失败时 latest=null 且 error 汇总各源原因 —— 上层据此显示「检查失败」，
 * 绝不允许落到「已是最新」。
 */
export async function lookupLatest(
  slug: string,
  channel: UpdateChannel,
  fetchImpl: FetchLike,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<LatestLookup> {
  const sources = buildSources(slug, channel);
  const outcomes = await Promise.all(sources.map((source) => readSource(source, fetchImpl, timeoutMs)));
  let latest: string | null = null;
  let source: string | null = null;
  for (const outcome of outcomes) {
    if (outcome.version === null) continue;
    if (latest === null || compareVersions(outcome.version, latest) > 0) {
      latest = outcome.version;
      source = outcome.label;
    }
  }
  if (latest !== null) return { latest, source, error: null };
  const reasons = outcomes.map((outcome) => outcome.label + ': ' + (outcome.error ?? '未知错误')).join('；');
  return { latest: null, source: null, error: reasons === '' ? '没有可用的版本源' : reasons };
}

/** 进程内缓存（key = slug + channel） */
const cache = new Map<string, { at: number; value: LatestLookup }>();

/** 清缓存（单测用，也给"强制刷新"留后门） */
export function resetLatestCache(): void {
  cache.clear();
}

/** 带缓存的查询结果 */
export interface CachedLookup extends LatestLookup {
  cached: boolean;
  checkedAt: number;
}

/**
 * 带缓存的查询。
 *
 * @param refresh - true 时绕过缓存（用户点了按钮）
 */
export async function checkLatest(options: {
  slug: string;
  channel: UpdateChannel;
  fetchImpl: FetchLike;
  refresh?: boolean;
  ttlMs?: number;
  now?: number;
  timeoutMs?: number;
}): Promise<CachedLookup> {
  const { slug, channel, fetchImpl } = options;
  const ttlMs = options.ttlMs ?? CHECK_TTL_MS;
  const now = options.now ?? Date.now();
  const key = slug + '|' + channel;
  const hit = cache.get(key);
  if (options.refresh !== true && hit !== undefined && now - hit.at < ttlMs) {
    return { ...hit.value, cached: true, checkedAt: hit.at };
  }
  const value = await lookupLatest(slug, channel, fetchImpl, options.timeoutMs);
  // 查失败不写缓存：下一次点按钮应该重新尝试，而不是把"查不到"钉住 6 小时
  if (value.latest !== null) cache.set(key, { at: now, value });
  return { ...value, cached: false, checkedAt: now };
}

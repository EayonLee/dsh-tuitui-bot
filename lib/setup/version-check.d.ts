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
export declare const CHECK_TTL_MS: number;
/** 单源超时：8 秒。慢的源不该拖住整个检查 */
export declare const CHECK_TIMEOUT_MS = 8000;
/**
 * 解析版本号。认 1.2.3 / v1.2.3 / 1.2.3-beta.1 三种写法。
 *
 * 不认就直接返回 0.0.0：宁可判成"很旧"，也不要抛错把整个检查打挂。
 */
export declare function parseVersion(raw: string): ParsedVersion;
/** 比较两个版本号：a>b 返回 1，a<b 返回 -1，相等 0 */
export declare function compareVersions(a: string, b: string): number;
/** candidate 是否比 current 新 */
export declare function isNewer(candidate: string, current: string): boolean;
/** 一个版本源 */
export interface VersionSource {
    /** 要请求的地址 */
    url: string;
    /** 展示给人看的来源名 */
    label: string;
    /** 从响应里取出未加工的版本字符串；取不到返回 null */
    parse: (payload: unknown) => string | null;
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
export declare function buildSources(slug: string, channel: UpdateChannel): VersionSource[];
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
export type FetchLike = (url: string, init?: {
    signal?: AbortSignal;
    headers?: Record<string, string>;
}) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    text(): Promise<string>;
}>;
/**
 * 并发查所有源，取最大版本。
 *
 * 全部失败时 latest=null 且 error 汇总各源原因 —— 上层据此显示「检查失败」，
 * 绝不允许落到「已是最新」。
 */
export declare function lookupLatest(slug: string, channel: UpdateChannel, fetchImpl: FetchLike, timeoutMs?: number): Promise<LatestLookup>;
/** 清缓存（单测用，也给"强制刷新"留后门） */
export declare function resetLatestCache(): void;
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
export declare function checkLatest(options: {
    slug: string;
    channel: UpdateChannel;
    fetchImpl: FetchLike;
    refresh?: boolean;
    ttlMs?: number;
    now?: number;
    timeoutMs?: number;
}): Promise<CachedLookup>;
//# sourceMappingURL=version-check.d.ts.map
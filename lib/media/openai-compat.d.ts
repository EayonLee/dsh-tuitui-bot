/**
 * OpenAI 兼容端点的极薄客户端 —— 只做两件事：看图、画图。
 *
 * 为什么自己写而不是复用 dsh 的 llm 服务：推推插件面向的是"随便一家 OpenAI 兼容网关"，
 * 用户手里往往只有一个 base url + key + 模型名；把它塞进 dsh 的 provider 体系反而更绕。
 * 这里对齐主流开源项目（open-webui / litellm）的做法：
 *
 *   - 只认 `/chat/completions`（看图）和 `/images/generations`（画图）两个端点
 *   - 密钥只存在服务端，任何返回值里都不出现
 *   - 失败一律抛 `ImageModelError`，带上游原文，方便用户自己判断是 key 错了还是模型名错了
 */
import type { ImageModelConfig } from '../config.ts';
export interface ImageModelError extends Error {
    /** HTTP 状态码（网络层失败时为 0） */
    status: number;
    /** 上游返回的原始错误文本（已截断） */
    upstream?: string;
}
export interface DescribeInput {
    /** 图片字节（本地/下载得到的） */
    bytes?: Uint8Array;
    /** 字节对应的 MIME，默认 image/png */
    mediaType?: string;
    /** 或者直接给一个 http(s) 图片地址 */
    url?: string;
    prompt: string;
}
export interface GeneratedImage {
    bytes: Uint8Array;
    mediaType: string;
}
export type FetchLike = (input: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
}) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
}>;
/** 去掉末尾斜杠；空串直接报错，让调用方给出"还没配"的明确提示 */
export declare function normalizeBaseUrl(baseUrl: string): string;
/** 用户自己配了端点（baseUrl + apiKey 都有）就走直连，否则退回 dsh llm */
export declare function isDirectEndpoint(config: {
    baseUrl?: string;
    apiKey?: string;
}): boolean;
/** 端点 + 模型 + 密钥齐了才算能用 */
export declare function assertConfigured(config: ImageModelConfig, label: string): void;
/** 看图：把图片塞进 chat/completions，取回文本 */
export declare function describeImage(config: ImageModelConfig & {
    maxTokens?: number;
    timeoutMs?: number;
}, input: DescribeInput, fetchImpl?: FetchLike): Promise<string>;
/** 画图：images/generations，返回图片字节（b64 或再取一次 url） */
export declare function generateImage(config: ImageModelConfig & {
    size?: string;
    timeoutMs?: number;
}, prompt: string, fetchImpl?: FetchLike): Promise<GeneratedImage>;
export interface ProbeResult {
    ok: boolean;
    /** 一句话结论，直接展示给用户 */
    detail: string;
    /** 上游报的模型列表里有没有配置的这个（拿不到列表时为 undefined） */
    modelFound?: boolean;
}
/**
 * 连接测试：先探 /models（最轻、不花钱），探不到再对这个端点做一次最小调用。
 * 任何情况下都不回显密钥。
 */
export declare function probeEndpoint(config: ImageModelConfig & {
    timeoutMs?: number;
}, 
/** 'vision' / 'image'：仅用于调用方语义标注，探测手段相同 */
_kind: 'vision' | 'image', fetchImpl?: FetchLike): Promise<ProbeResult>;
//# sourceMappingURL=openai-compat.d.ts.map
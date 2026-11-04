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

function fail(status: number, message: string, upstream?: string): ImageModelError {
  const error = new Error(message) as ImageModelError;
  error.status = status;
  if (upstream !== undefined) error.upstream = upstream.slice(0, 500);
  return error;
}

/** 去掉末尾斜杠；空串直接报错，让调用方给出"还没配"的明确提示 */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed === '') throw fail(0, '还没配置端点地址（base url）');
  return trimmed.replace(/\/+$/, '');
}

/** 用户自己配了端点（baseUrl + apiKey 都有）就走直连，否则退回 dsh llm */
export function isDirectEndpoint(config: { baseUrl?: string; apiKey?: string }): boolean {
  return (config.baseUrl ?? '').trim() !== '' && (config.apiKey ?? '').trim() !== '';
}

/** 端点 + 模型 + 密钥齐了才算能用 */
export function assertConfigured(config: ImageModelConfig, label: string): void {
  if (config.baseUrl.trim() === '') throw fail(0, `${label}还没配置端点地址`);
  if (config.model.trim() === '') throw fail(0, `${label}还没配置模型 id`);
  if (config.apiKey.trim() === '') throw fail(0, `${label}还没配置密钥`);
}

function headers(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey.trim()}`,
  };
}

/** 从 OpenAI 风格错误体里挖出一句人话 */
function upstreamMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown }; message?: unknown };
    const message = parsed.error?.message ?? parsed.message;
    if (typeof message === 'string' && message !== '') return message;
  } catch {
    // 不是 JSON 就原样截断
  }
  return raw.slice(0, 300);
}

async function postJson(
  fetchImpl: FetchLike,
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw fail(response.status, `上游返回 ${response.status}: ${upstreamMessage(raw)}`, raw);
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw fail(response.status, '上游返回的不是 JSON', raw);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw fail(0, `请求超时（${Math.round(timeoutMs / 1000)}秒）`);
    }
    if (error instanceof Error && 'status' in error) throw error;
    throw fail(0, `连不上端点: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 把 content 拆成纯文本（兼容 string 与分片数组两种返回） */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : ''))
      .join('')
      .trim();
  }
  return '';
}

/** 看图：把图片塞进 chat/completions，取回文本 */
export async function describeImage(
  config: ImageModelConfig & { maxTokens?: number; timeoutMs?: number },
  input: DescribeInput,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<string> {
  assertConfigured(config, '图像理解');
  const base = normalizeBaseUrl(config.baseUrl);

  let imageUrl: string;
  if (input.url !== undefined && input.url !== '') {
    imageUrl = input.url;
  } else if (input.bytes !== undefined) {
    const mediaType = input.mediaType ?? 'image/png';
    imageUrl = `data:${mediaType};base64,${Buffer.from(input.bytes).toString('base64')}`;
  } else {
    throw fail(0, '没有图片内容');
  }

  const payload = {
    model: config.model.trim(),
    max_tokens: config.maxTokens ?? 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: input.prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
  };

  const data = await postJson(
    fetchImpl,
    `${base}/chat/completions`,
    config.apiKey,
    payload,
    config.timeoutMs ?? 120000,
  ) as { choices?: Array<{ message?: { content?: unknown } }> };
  const text = contentToText(data.choices?.[0]?.message?.content);
  if (text === '') throw fail(0, '模型没有返回文本（可能不是视觉模型）');
  return text;
}

/** 画图：images/generations，返回图片字节（b64 或再取一次 url） */
export async function generateImage(
  config: ImageModelConfig & { size?: string; timeoutMs?: number },
  prompt: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<GeneratedImage> {
  assertConfigured(config, '图像生成');
  const base = normalizeBaseUrl(config.baseUrl);
  const payload = {
    model: config.model.trim(),
    prompt,
    n: 1,
    ...(config.size !== undefined && config.size !== '' ? { size: config.size } : {}),
  };

  const data = await postJson(
    fetchImpl,
    `${base}/images/generations`,
    config.apiKey,
    payload,
    config.timeoutMs ?? 180000,
  ) as { data?: Array<{ b64_json?: string; url?: string }> };

  const first = data.data?.[0];
  if (first === undefined) throw fail(0, '上游没返回图片');
  if (typeof first.b64_json === 'string' && first.b64_json !== '') {
    return { bytes: Uint8Array.from(Buffer.from(first.b64_json, 'base64')), mediaType: 'image/png' };
  }
  if (typeof first.url === 'string' && first.url !== '') {
    const response = await fetchImpl(first.url, { method: 'GET' });
    if (!response.ok) throw fail(response.status, `图片下载失败（${response.status}）`);
    const raw = await response.text();
    // b64 走的是 text()，这里图片是二进制：用 Buffer 还原（FetchLike 只暴露 text 便于测试）
    return { bytes: Uint8Array.from(Buffer.from(raw, 'binary')), mediaType: 'image/png' };
  }
  throw fail(0, '上游返回里既没有 b64_json 也没有 url');
}

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
/**
 * 探活：只用 `GET /models` 验证「地址通、密钥对」。
 *
 * 刻意不碰 `/chat/completions` 和 `/images/generations`：那是要花钱、要跑模型的活，
 * 一个「测试连接」按钮不该顺手消耗额度，也不该因为模型参数不对而报"连接失败"。
 */
export async function probeEndpoint(
  config: ImageModelConfig & { timeoutMs?: number },
  /** 'vision' / 'image'：仅用于调用方语义标注，探测手段相同 */
  _kind: 'vision' | 'image',
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<ProbeResult> {
  if (config.baseUrl.trim() === '') return { ok: false, detail: '先填地址再测试' };
  if (config.apiKey.trim() === '') return { ok: false, detail: '先填密钥（或者先保存一次）再测试' };
  const base = normalizeBaseUrl(config.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, config.timeoutMs ?? 20000));
  try {
    const response = await fetchImpl(`${base}/models`, {
      method: 'GET',
      headers: headers(config.apiKey),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (response.ok) {
      let ids: string[] = [];
      try {
        const parsed = JSON.parse(raw) as { data?: Array<{ id?: unknown }> };
        ids = (parsed.data ?? []).map((m) => (typeof m.id === 'string' ? m.id : '')).filter((id) => id !== '');
      } catch {
        // 列表解析失败不影响"连得上"这个结论
      }
      const modelFound = ids.length === 0 ? undefined : ids.includes(config.model.trim());
      const suffix = modelFound === false ? `（端点可达，但模型列表里没有 ${config.model}）` : '';
      return { ok: true, detail: `连接正常，鉴权通过${suffix}`, modelFound };
    }
    if (response.status === 404) {
      return {
        ok: true,
        detail: '端点可达（该网关没有 /models 接口，保存后试一次真实调用最准）',
        modelFound: undefined,
      };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, detail: `鉴权失败（${response.status}）：密钥不对或没有权限` };
    }
    return { ok: false, detail: `网关返回 ${response.status}：${upstreamMessage(raw)}` };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return { ok: false, detail: '连接超时' };
    return { ok: false, detail: `连不上端点: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

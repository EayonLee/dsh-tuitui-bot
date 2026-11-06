/** 按魔法字节嗅探图片类型；认不出时返回 undefined */
export function sniffImageMediaType(bytes) {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'image/jpeg';
    if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)
        return 'image/gif';
    if (bytes.length >= 12
        && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return 'image/webp';
    }
    return undefined;
}
function fail(status, message, upstream) {
    const error = new Error(message);
    error.status = status;
    if (upstream !== undefined)
        error.upstream = upstream.slice(0, 500);
    return error;
}
/** 去掉末尾斜杠；空串直接报错，让调用方给出"还没配"的明确提示 */
export function normalizeBaseUrl(baseUrl) {
    const trimmed = baseUrl.trim();
    if (trimmed === '')
        throw fail(0, '还没配置端点地址（base url）');
    return trimmed.replace(/\/+$/, '');
}
/** 用户自己配了端点（baseUrl + apiKey 都有）就走直连，否则退回 dsh llm */
export function isDirectEndpoint(config) {
    return (config.baseUrl ?? '').trim() !== '' && (config.apiKey ?? '').trim() !== '';
}
/** 端点 + 模型 + 密钥齐了才算能用 */
export function assertConfigured(config, label) {
    if (config.baseUrl.trim() === '')
        throw fail(0, `${label}还没配置端点地址`);
    if (config.model.trim() === '')
        throw fail(0, `${label}还没配置模型 id`);
    if (config.apiKey.trim() === '')
        throw fail(0, `${label}还没配置密钥`);
}
function headers(apiKey) {
    return {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey.trim()}`,
    };
}
/** 从 OpenAI 风格错误体里挖出一句人话 */
function upstreamMessage(raw) {
    try {
        const parsed = JSON.parse(raw);
        const message = parsed.error?.message ?? parsed.message;
        if (typeof message === 'string' && message !== '')
            return message;
    }
    catch {
        // 不是 JSON 就原样截断
    }
    return raw.slice(0, 300);
}
async function postJson(fetchImpl, url, apiKey, body, timeoutMs) {
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
            return JSON.parse(raw);
        }
        catch {
            throw fail(response.status, '上游返回的不是 JSON', raw);
        }
    }
    catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw fail(0, `请求超时（${Math.round(timeoutMs / 1000)}秒）`);
        }
        if (error instanceof Error && 'status' in error)
            throw error;
        throw fail(0, `连不上端点: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        clearTimeout(timer);
    }
}
/** 把 content 拆成纯文本（兼容 string 与分片数组两种返回） */
function contentToText(content) {
    if (typeof content === 'string')
        return content.trim();
    if (Array.isArray(content)) {
        return content
            .map((part) => (typeof part === 'object' && part !== null && typeof part.text === 'string'
            ? part.text
            : ''))
            .join('')
            .trim();
    }
    return '';
}
/** 看图：把图片塞进 chat/completions，取回文本 */
export async function describeImage(config, input, fetchImpl = globalThis.fetch) {
    assertConfigured(config, '图像理解');
    const base = normalizeBaseUrl(config.baseUrl);
    let imageUrl;
    if (input.url !== undefined && input.url !== '') {
        imageUrl = input.url;
    }
    else if (input.bytes !== undefined) {
        const mediaType = input.mediaType ?? 'image/png';
        imageUrl = `data:${mediaType};base64,${Buffer.from(input.bytes).toString('base64')}`;
    }
    else {
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
    const data = await postJson(fetchImpl, `${base}/chat/completions`, config.apiKey, payload, config.timeoutMs ?? 120000);
    const text = contentToText(data.choices?.[0]?.message?.content);
    if (text === '')
        throw fail(0, '模型没有返回文本（可能不是视觉模型）');
    return text;
}
/** 画图：images/generations，返回图片字节（b64 或再取一次 url） */
export async function generateImage(config, prompt, fetchImpl = globalThis.fetch) {
    assertConfigured(config, '图像生成');
    const base = normalizeBaseUrl(config.baseUrl);
    const payload = {
        model: config.model.trim(),
        prompt,
        n: 1,
        ...(config.size !== undefined && config.size !== '' ? { size: config.size } : {}),
    };
    const data = await postJson(fetchImpl, `${base}/images/generations`, config.apiKey, payload, config.timeoutMs ?? 180000);
    const first = data.data?.[0];
    if (first === undefined)
        throw fail(0, '上游没返回图片');
    if (typeof first.b64_json === 'string' && first.b64_json !== '') {
        return { bytes: Uint8Array.from(Buffer.from(first.b64_json, 'base64')), mediaType: 'image/png' };
    }
    if (typeof first.url === 'string' && first.url !== '') {
        const response = await fetchImpl(first.url, { method: 'GET' });
        if (!response.ok)
            throw fail(response.status, `图片下载失败（${response.status}）`);
        // 二进制必须走 arrayBuffer()：text() 会按 UTF-8 解码，0x89 这类字节会被替换掉（#43）
        if (typeof response.arrayBuffer !== 'function') {
            throw fail(0, '图片下载失败：当前 fetch 实现不支持 arrayBuffer，无法安全读取二进制');
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length === 0)
            throw fail(0, '图片下载失败：返回内容为空');
        const headerType = response.headers?.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        const mediaType = headerType?.startsWith('image/') === true
            ? headerType
            : (sniffImageMediaType(bytes) ?? 'image/png');
        return { bytes, mediaType };
    }
    throw fail(0, '上游返回里既没有 b64_json 也没有 url');
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
export async function probeEndpoint(config, 
/** 'vision' / 'image'：仅用于调用方语义标注，探测手段相同 */
_kind, fetchImpl = globalThis.fetch) {
    if (config.baseUrl.trim() === '')
        return { ok: false, detail: '先填地址再测试' };
    if (config.apiKey.trim() === '')
        return { ok: false, detail: '先填密钥（或者先保存一次）再测试' };
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
            let ids = [];
            try {
                const parsed = JSON.parse(raw);
                ids = (parsed.data ?? []).map((m) => (typeof m.id === 'string' ? m.id : '')).filter((id) => id !== '');
            }
            catch {
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
    }
    catch (error) {
        if (error instanceof Error && error.name === 'AbortError')
            return { ok: false, detail: '连接超时' };
        return { ok: false, detail: `连不上端点: ${error instanceof Error ? error.message : String(error)}` };
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=openai-compat.js.map
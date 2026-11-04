/**
 * media/openai-compat 单测 —— OpenAI 兼容端点客户端
 *
 * 覆盖：看图（data url 构造 / string 与分片两种返回 / 非视觉模型）、
 * 画图（b64 与 url 两条路径）、错误归一化（401、超时、非 JSON）、
 * 连接探测（/models 命中、模型不在列表、404、401、网络失败）。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  assertConfigured,
  describeImage,
  generateImage,
  isDirectEndpoint,
  normalizeBaseUrl,
  probeEndpoint,
  type FetchLike,
} from './openai-compat.ts';

const config = {
  enabled: true,
  baseUrl: 'https://llm.api.zyuncs.com/v1/',
  apiKey: 'sk-test-123',
  model: 'qwen/qwen3-vl-30b-a3b-instruct',
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function textResponse(body: string, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

describe('normalizeBaseUrl / assertConfigured', () => {
  it('去掉末尾斜杠，避免 //chat/completions', () => {
    expect(normalizeBaseUrl('https://x/v1/')).toBe('https://x/v1');
    expect(normalizeBaseUrl('  https://x/v1///  ')).toBe('https://x/v1');
  });

  it('空串报「还没配置」，不发出请求', () => {
    expect(() => normalizeBaseUrl('   ')).toThrow(/还没配置端点地址/);
  });

  it('三样缺任何一样都直接拒绝，且提示里点明缺的是哪个', () => {
    expect(() => assertConfigured({ ...config, baseUrl: '' }, '图像理解')).toThrow(/图像理解.*端点地址/);
    expect(() => assertConfigured({ ...config, model: '' }, '图像生成')).toThrow(/图像生成.*模型 id/);
    expect(() => assertConfigured({ ...config, apiKey: '' }, '图像理解')).toThrow(/图像理解.*密钥/);
  });

  it('isDirectEndpoint：地址和密钥都有才算配好', () => {
    expect(isDirectEndpoint({ baseUrl: 'https://x', apiKey: 'k' })).toBe(true);
    expect(isDirectEndpoint({ baseUrl: 'https://x', apiKey: '' })).toBe(false);
    expect(isDirectEndpoint({})).toBe(false);
  });
});

describe('describeImage', () => {
  it('把图片字节转成 data url 发到 chat/completions，并带回模型文本', async () => {
    const calls: Array<{ url: string; body: string; auth: string | undefined }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({
        url,
        body: init?.body ?? '',
        auth: init?.headers?.authorization,
      });
      return jsonResponse({ choices: [{ message: { content: '图里是一只猫' } }] });
    };

    const text = await describeImage(config, {
      bytes: Uint8Array.from([1, 2, 3]),
      mediaType: 'image/jpeg',
      prompt: '这是什么',
    }, fetchImpl);

    expect(text).toBe('图里是一只猫');
    expect(calls[0]?.url).toBe('https://llm.api.zyuncs.com/v1/chat/completions');
    expect(calls[0]?.auth).toBe('Bearer sk-test-123');
    const body = JSON.parse(calls[0]?.body ?? '{}') as {
      model: string;
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
    };
    expect(body.model).toBe('qwen/qwen3-vl-30b-a3b-instruct');
    expect(body.messages[0]?.content[1]?.image_url?.url).toBe('data:image/jpeg;base64,AQID');
  });

  it('给了 http 地址就直接透传，不重新编码', async () => {
    let sent = '';
    const fetchImpl: FetchLike = async (_url, init) => {
      sent = init?.body ?? '';
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    };
    await describeImage(config, { url: 'https://img/x.png', prompt: 'p' }, fetchImpl);
    expect(sent).toContain('https://img/x.png');
  });

  it('content 是分片数组时也能拼出文本', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({
      choices: [{ message: { content: [{ type: 'text', text: '甲' }, { type: 'text', text: '乙' }] } }],
    });
    expect(await describeImage(config, { bytes: Uint8Array.from([0]), prompt: 'p' }, fetchImpl)).toBe('甲乙');
  });

  it('模型没吐文本时明确报「可能不是视觉模型」', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ choices: [{ message: { content: '' } }] });
    await expect(describeImage(config, { bytes: Uint8Array.from([0]), prompt: 'p' }, fetchImpl))
      .rejects.toThrow(/不是视觉模型/);
  });

  it('401 时把上游原话带出来，便于判断是 key 还是权限', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ error: { message: 'invalid api key' } }, 401);
    await expect(describeImage(config, { bytes: Uint8Array.from([0]), prompt: 'p' }, fetchImpl))
      .rejects.toThrow(/401.*invalid api key/);
  });

  it('上游返回非 JSON 时不当成成功', async () => {
    const fetchImpl: FetchLike = async () => textResponse('<html>502</html>', 502);
    await expect(describeImage(config, { bytes: Uint8Array.from([0]), prompt: 'p' }, fetchImpl))
      .rejects.toThrow(/502/);
  });

  it('没有图片内容时报错，不会发出空请求', async () => {
    const fetchImpl = vi.fn() as unknown as FetchLike;
    await expect(describeImage(config, { prompt: 'p' }, fetchImpl)).rejects.toThrow(/没有图片内容/);
  });
});

describe('generateImage', () => {
  const imageConfig = { ...config, model: 'qwen/qwen-image-2512', size: '1024x1024' };

  it('解析 b64_json 并带上 size', async () => {
    const bodies: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(init?.body ?? '');
      return jsonResponse({ data: [{ b64_json: Buffer.from('hello').toString('base64') }] });
    };
    const out = await generateImage(imageConfig, '一只猫', fetchImpl);
    expect(Buffer.from(out.bytes).toString()).toBe('hello');
    expect(out.mediaType).toBe('image/png');
    const body = JSON.parse(bodies[0] ?? '{}') as { size: string; prompt: string; n: number };
    expect(body.size).toBe('1024x1024');
    expect(body.prompt).toBe('一只猫');
    expect(body.n).toBe(1);
  });

  it('size 为空时不把空串发上去', async () => {
    let body = '';
    const fetchImpl: FetchLike = async (_url, init) => {
      body = init?.body ?? '';
      return jsonResponse({ data: [{ b64_json: 'AA==' }] });
    };
    await generateImage({ ...imageConfig, size: '' }, 'p', fetchImpl);
    expect(JSON.parse(body)).not.toHaveProperty('size');
  });

  it('返回 url 时再取一次字节', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes('images/generations')) return jsonResponse({ data: [{ url: 'https://cdn/x.png' }] });
      return textResponse('PNGDATA');
    };
    const out = await generateImage(imageConfig, 'p', fetchImpl);
    expect(Buffer.from(out.bytes).toString()).toBe('PNGDATA');
  });

  it('既没有 b64 也没有 url 时报错', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ data: [{}] });
    await expect(generateImage(imageConfig, 'p', fetchImpl)).rejects.toThrow(/b64_json/);
  });
});

describe('probeEndpoint', () => {
  it('鉴权通过且模型列表里有它 → 连接正常', async () => {
    const fetchImpl: FetchLike = async (url, init) => {
      expect(url).toBe('https://llm.api.zyuncs.com/v1/models');
      expect(init?.headers?.authorization).toBe('Bearer sk-test-123');
      return jsonResponse({ data: [{ id: config.model }, { id: 'other' }] });
    };
    const result = await probeEndpoint(config, 'vision', fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.modelFound).toBe(true);
    expect(result.detail).toContain('连接正常');
  });

  it('模型不在列表里仍然算连得上，但要说出来', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ data: [{ id: 'other' }] });
    const result = await probeEndpoint(config, 'image', fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.modelFound).toBe(false);
    expect(result.detail).toContain('模型列表里没有');
  });

  it('404 表示网关没有 /models，按"可达"处理而不是失败', async () => {
    const fetchImpl: FetchLike = async () => textResponse('not found', 404);
    const result = await probeEndpoint(config, 'image', fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('没有 /models');
  });

  it('401 明确说鉴权失败', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ error: { message: 'bad key' } }, 401);
    const result = await probeEndpoint(config, 'vision', fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('鉴权失败');
  });

  it('网络不通时给出可读原因', async () => {
    const fetchImpl: FetchLike = async () => { throw new Error('ECONNREFUSED'); };
    const result = await probeEndpoint(config, 'vision', fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('连不上端点');
  });

  it('缺地址或缺密钥时不发请求', async () => {
    const fetchImpl = vi.fn() as unknown as FetchLike;
    expect((await probeEndpoint({ ...config, baseUrl: '' }, 'vision', fetchImpl)).ok).toBe(false);
    expect((await probeEndpoint({ ...config, apiKey: '' }, 'vision', fetchImpl)).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/**
 * 设置路由里的"图像理解 / 生成"端点部分
 *
 * 覆盖三件要紧的事：
 *   1. 密钥只写不读 —— GET 快照里永远没有明文，只有 apiKeySet 布尔
 *   2. 留空保存 = 不改动已存密钥（提交空串时根本不进写入列表）
 *   3. 连接测试用"表单值优先、缺省回落到已保存值"，且响应里不含密钥
 */
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BIND_CONFIG_PATH, TEST_MODEL_PATH, registerBindRoutes, type WebRoute } from './bind-routes.ts';
import type { ImTuituiConfig } from '../config.ts';
import type { Logger } from '../types.ts';

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger;

function makeRes() {
  const res = {
    statusCode: 0,
    body: '',
    writeHead(status: number) { res.statusCode = status; return res; },
    end(payload?: string) { res.body = payload ?? ''; },
    json(): any { return JSON.parse(res.body); },
  };
  return res;
}

function makeReq(method: string, body?: unknown, headers: Record<string, string> = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  return Object.assign(req, { method, headers: { host: '127.0.0.1:3080', ...headers } }) as any;
}

function harness(current: Partial<ImTuituiConfig>, onUpdateConfig?: (patch: Record<string, unknown>) => boolean) {
  const routes: WebRoute[] = [];
  registerBindRoutes(
    { register(route) { routes.push(route); return () => {}; } },
    null,
    logger,
    {
      currentConfig: () => current as ImTuituiConfig,
      onUpdateConfig: onUpdateConfig ?? (() => true),
    },
  );
  const call = async (path: string, req: any) => {
    const route = routes.find((item) => item.path === path);
    if (route === undefined) throw new Error('路由未注册: ' + path);
    const res = makeRes();
    await route.handler(req, res as never);
    return res;
  };
  return { routes, call };
}

const saved = {
  vision: {
    enabled: true,
    baseUrl: 'https://llm.api.zyuncs.com/v1',
    apiKey: 'sk-live-secret',
    provider: '',
    model: 'qwen/qwen3-vl-30b-a3b-instruct',
    defaultPrompt: 'p',
    maxBytes: 1024,
    maxTokens: 100,
    timeoutMs: 1000,
  },
  imageGeneration: {
    enabled: true,
    baseUrl: 'https://llm.api.zyuncs.com/v1',
    apiKey: 'sk-image-secret',
    model: 'qwen/qwen-image-2512',
    size: '1024x1024',
    timeoutMs: 1000,
  },
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('GET 配置快照', () => {
  it('不下发密钥，只给 apiKeySet 标记', async () => {
    const { call } = harness(saved);
    const res = await call(BIND_CONFIG_PATH, makeReq('GET'));
    const body = res.json() as { config: Record<string, unknown> };

    expect(body.config['vision.apiKey']).toBeUndefined();
    expect(body.config['imageGeneration.apiKey']).toBeUndefined();
    expect(body.config['vision.apiKeySet']).toBe(true);
    expect(body.config['imageGeneration.apiKeySet']).toBe(true);
    // 地址和模型 id 可以回显（不是机密）
    expect(body.config['vision.baseUrl']).toBe('https://llm.api.zyuncs.com/v1');
    expect(body.config['imageGeneration.model']).toBe('qwen/qwen-image-2512');
    expect(res.body).not.toContain('sk-live-secret');
    expect(res.body).not.toContain('sk-image-secret');
  });

  it('没存过密钥时标记为 false', async () => {
    const { call } = harness({ vision: { ...saved.vision, apiKey: '' } });
    const res = await call(BIND_CONFIG_PATH, makeReq('GET'));
    expect((res.json() as any).config['vision.apiKeySet']).toBe(false);
  });
});

describe('POST 保存配置', () => {
  it('密钥留空不进入写入列表（＝不改动已存的那份）', async () => {
    let patch: Record<string, unknown> = {};
    const { call } = harness(saved, (p) => { patch = p; return true; });
    const res = await call(BIND_CONFIG_PATH, makeReq('POST', {
      'vision.apiKey': '',
      'imageGeneration.apiKey': '',
      'vision.model': 'qwen/qwen3-vl-2b-instruct',
    }));

    expect(res.statusCode).toBe(200);
    expect(patch).toEqual({ 'vision.model': 'qwen/qwen3-vl-2b-instruct' });
  });

  it('填了新密钥就写进去', async () => {
    let patch: Record<string, unknown> = {};
    const { call } = harness(saved, (p) => { patch = p; return true; });
    await call(BIND_CONFIG_PATH, makeReq('POST', { 'imageGeneration.apiKey': 'sk-new' }));
    expect(patch).toEqual({ 'imageGeneration.apiKey': 'sk-new' });
  });

  it('地址必须 http(s)，密钥不能带空白', async () => {
    const { call } = harness(saved);
    const bad = await call(BIND_CONFIG_PATH, makeReq('POST', { 'vision.baseUrl': 'llm.api.zyuncs.com' }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain('http(s)');

    const badKey = await call(BIND_CONFIG_PATH, makeReq('POST', { 'vision.apiKey': 'sk a b' }));
    expect(badKey.statusCode).toBe(400);
    expect(badKey.json().error).toContain('空白');
  });
});

describe('POST /test-model 连接测试', () => {
  it('不传密钥时用已保存的密钥探测，响应里不含密钥', async () => {
    const seen: Array<{ url: string; auth?: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      seen.push({ url, auth: init?.headers?.authorization });
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: saved.vision.model }] }) };
    });

    const { call } = harness(saved);
    const res = await call(TEST_MODEL_PATH, makeReq('POST', {
      kind: 'vision',
      baseUrl: 'https://llm.api.zyuncs.com/v1',
      model: saved.vision.model,
      apiKey: '',
    }));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, modelFound: true });
    expect(seen[0]?.url).toBe('https://llm.api.zyuncs.com/v1/models');
    expect(seen[0]?.auth).toBe('Bearer sk-live-secret');
    expect(res.body).not.toContain('sk-live-secret');
  });

  it('表单里填了新密钥就优先用它（还没保存也能测）', async () => {
    let auth = '';
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      auth = init?.headers?.authorization;
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) };
    });

    const { call } = harness(saved);
    await call(TEST_MODEL_PATH, makeReq('POST', {
      kind: 'image', baseUrl: 'https://llm.api.zyuncs.com/v1', model: saved.imageGeneration.model, apiKey: 'sk-typed',
    }));
    expect(auth).toBe('Bearer sk-typed');
  });

  it('没填地址 / 没填也存不到密钥时，直接给出可读的失败原因', async () => {
    const { call } = harness({ ...saved, vision: { ...saved.vision, baseUrl: '', apiKey: '' } });

    const noUrl = await call(TEST_MODEL_PATH, makeReq('POST', { kind: 'vision', baseUrl: '', model: 'm' }));
    expect(noUrl.statusCode).toBe(200);
    expect(noUrl.json()).toMatchObject({ ok: false });
    expect(noUrl.json().detail).toContain('先填地址');

    const noKey = await call(TEST_MODEL_PATH, makeReq('POST', { kind: 'vision', baseUrl: 'https://x.example/v1', model: 'm', apiKey: '' }));
    expect(noKey.json()).toMatchObject({ ok: false });
    expect(noKey.json().detail).toContain('先填密钥');
  });

  it('只探 /models，不碰 chat 与 images', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) };
    });

    const { call } = harness(saved);
    await call(TEST_MODEL_PATH, makeReq('POST', { kind: 'image', baseUrl: 'https://llm.api.zyuncs.com/v1', model: saved.imageGeneration.model }));

    expect(urls).toHaveLength(1);
    expect(urls[0]?.endsWith('/models')).toBe(true);
    expect(urls.some((u) => u.includes('images') || u.includes('chat'))).toBe(false);
  });

  it('kind 非法 / 方法不对 / 跨源都拒绝', async () => {
    const { call } = harness(saved);
    expect((await call(TEST_MODEL_PATH, makeReq('POST', { kind: 'audio' }))).statusCode).toBe(400);
    expect((await call(TEST_MODEL_PATH, makeReq('GET'))).statusCode).toBe(405);
    expect((await call(TEST_MODEL_PATH, makeReq('POST', { kind: 'vision' }, { origin: 'https://evil.example' }))).statusCode).toBe(403);
  });

  it('上游鉴权失败时把原因原话回给用户', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'bad key' } }) }));
    const { call } = harness(saved);
    const res = await call(TEST_MODEL_PATH, makeReq('POST', { kind: 'vision' }));
    expect(res.json().ok).toBe(false);
    expect(res.json().detail).toContain('鉴权失败');
  });
});

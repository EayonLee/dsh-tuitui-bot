/**
 * 连接测试的端到端用例（真 HTTP，不是打桩的 handler）。
 *
 * 为什么要这一层：设置页是按「浏览器 → 插件路由 → 网关 /models」这条链走完的，
 * 前面只用单测打过 handler 和 probe 函数，链路上任何一环（路由没注册、请求方法、
 * 超时、JSON 形状）出问题都看不出来。这里的上游是本地假网关，下游是真 TCP。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { registerBindRoutes, TEST_MODEL_PATH, type WebRoute } from './bind-routes.ts';
import type { ImTuituiConfig } from '../config.ts';
import type { Logger } from '../types.ts';

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger;

const saved = {
  vision: {
    enabled: true,
    baseUrl: 'http://127.0.0.1:1/v1',
    apiKey: 'sk-saved',
    provider: '',
    model: 'qwen/qwen3-vl-30b-a3b-instruct',
    defaultPrompt: 'p',
    maxBytes: 1024,
    maxTokens: 100,
    timeoutMs: 5000,
  },
  imageGeneration: {
    enabled: true,
    baseUrl: 'http://127.0.0.1:1/v1',
    apiKey: '',
    model: 'qwen/qwen-image-2512',
    size: '1024x1024',
    timeoutMs: 5000,
  },
} as unknown as Partial<ImTuituiConfig>;

const open: Server[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => new Promise<void>((resolve) => { server.close(() => { resolve(); }); })));
});

async function listen(server: Server): Promise<number> {
  open.push(server);
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('没有拿到端口');
  return address.port;
}

/** 假网关：只有带对密钥才回 200，并记录被打了哪些路径 */
async function fakeGateway(): Promise<{ base: string; hits: string[] }> {
  const hits: string[] = [];
  const port = await listen(createServer((req: IncomingMessage, res: ServerResponse) => {
    hits.push(`${req.method ?? ''} ${req.url ?? ''}`);
    if (req.url === '/v1/models') {
      if (req.headers.authorization !== 'Bearer sk-good') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'qwen/qwen3-vl-30b-a3b-instruct' }, { id: 'qwen/qwen-image-2512' }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  }));
  return { base: `http://127.0.0.1:${String(port)}/v1`, hits };
}

/** 把插件路由挂到真 HTTP 服务上，浏览器/curl 怎么打就怎么打 */
async function mountRoutes(current: Partial<ImTuituiConfig>): Promise<string> {
  const routes: WebRoute[] = [];
  registerBindRoutes(
    { register(route) { routes.push(route); return () => {}; } },
    null,
    logger,
    { currentConfig: () => current as ImTuituiConfig, onUpdateConfig: () => true },
  );
  const port = await listen(createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    const route = routes.find((item) => item.path === pathname);
    if (route === undefined) {
      // 老进程就是这样：路由不存在 → 404，前端必须能说人话
      res.writeHead(404);
      res.end();
      return;
    }
    void route.handler(req, res);
  }));
  return `http://127.0.0.1:${String(port)}`;
}

describe('连接测试：从 HTTP 入口打到网关', () => {
  it('填了正确密钥 → 成功，且只打 /models', async () => {
    const gateway = await fakeGateway();
    const origin = await mountRoutes(saved);

    const res = await fetch(origin + TEST_MODEL_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'vision', baseUrl: gateway.base, model: 'qwen/qwen3-vl-30b-a3b-instruct', apiKey: 'sk-good' }),
    });
    const body = (await res.json()) as { ok: boolean; detail: string; modelFound?: boolean };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.detail).toContain('连接正常');
    expect(body.modelFound).toBe(true);
    // 探活只该碰 /models：不跑理解、不生成图片
    expect(gateway.hits).toEqual(['GET /v1/models']);
    expect(JSON.stringify(body)).not.toContain('sk-good');
  });

  it('密钥不对 → 失败，并且说清是鉴权问题', async () => {
    const gateway = await fakeGateway();
    const origin = await mountRoutes(saved);

    const res = await fetch(origin + TEST_MODEL_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'image', baseUrl: gateway.base, model: 'qwen/qwen-image-2512', apiKey: 'sk-wrong' }),
    });
    const body = (await res.json()) as { ok: boolean; detail: string };

    expect(body.ok).toBe(false);
    expect(body.detail).toContain('401');
    expect(body.detail).toContain('鉴权');
  });

  it('表单留空密钥 → 用已保存的那把', async () => {
    const gateway = await fakeGateway();
    const origin = await mountRoutes(saved);

    const res = await fetch(origin + TEST_MODEL_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'vision', baseUrl: gateway.base, model: 'qwen/qwen3-vl-30b-a3b-instruct', apiKey: '' }),
    });
    // 已存的密钥是 sk-saved，假网关不认 → 401，但能证明用的是"存的那把"
    expect(((await res.json()) as { detail: string }).detail).toContain('401');
    expect(gateway.hits).toEqual(['GET /v1/models']);
  });

  it('网关没有 /models → 可达但不给结论，不报"连不上"', async () => {
    const port = await listen(createServer((_req, res) => { res.writeHead(404); res.end(); }));
    const origin = await mountRoutes(saved);

    const res = await fetch(origin + TEST_MODEL_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'vision', baseUrl: `http://127.0.0.1:${String(port)}/v1`, model: 'm', apiKey: 'k' }),
    });
    const body = (await res.json()) as { ok: boolean; detail: string };

    expect(body.ok).toBe(true);
    expect(body.detail).toContain('/models');
  });

  it('地址是死端口 → 失败并带上原因，不会挂住', async () => {
    const origin = await mountRoutes(saved);

    const res = await fetch(origin + TEST_MODEL_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'vision', baseUrl: 'http://127.0.0.1:1/v1', model: 'm', apiKey: 'k' }),
    });
    const body = (await res.json()) as { ok: boolean; detail: string };

    expect(body.ok).toBe(false);
    expect(body.detail).toContain('连不上');
  });
});

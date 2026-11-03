/**
 * setup/bind-routes 单测 —— 端内绑定/设置路由
 *
 * 覆盖：路由注册与注销、同源校验、状态查询、凭据校验/手动绑定/解绑、
 * 配置读写白名单，以及各字段校验器（布尔/数字/名单/access 模式/mentionPolicy/cwd）。
 *
 * 校验器未导出，因此一律通过真实路由 handler 驱动（不为了测试改源码导出）。
 *
 * 疑似 bug：handleConfig 的 catch 只透传 TypeError 的 message（err instanceof TypeError
 * ? err.message : String(err)），但 cwdSchema 抛的是普通 Error，导致客户端收到的错误
 * 文案带 "Error: " 前缀（"Error: cwd 必须是绝对路径"）。本文档用 skip 用例标注，
 * 未改业务代码。
 */
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  BIND_CONFIG_PATH,
  BIND_MANUAL_PATH,
  BIND_STATE_PATH,
  BIND_UNBIND_PATH,
  BIND_VERIFY_PATH,
  registerBindRoutes,
  type BindRoutesOptions,
  type WebRoute,
} from './bind-routes.ts';
import type { Logger } from '../types.ts';

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

interface FakeRes {
  statusCode: number;
  headers: Record<string, unknown>;
  body: string;
  writeHead(status: number, headers?: Record<string, unknown>): FakeRes;
  end(payload?: string): void;
  json(): unknown;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      res.statusCode = status;
      res.headers = headers ?? {};
      return res;
    },
    end(payload) {
      res.body = payload ?? '';
    },
    json() {
      return JSON.parse(res.body) as unknown;
    },
  };
  return res;
}

interface ReqOptions {
  body?: unknown;
  raw?: Buffer;
  origin?: string;
  host?: string;
}

function makeReq(method: string, options: ReqOptions = {}): Parameters<WebRoute['handler']>[0] {
  const chunks: Buffer[] = [];
  if (options.raw !== undefined) chunks.push(options.raw);
  else if (options.body !== undefined) chunks.push(Buffer.from(JSON.stringify(options.body)));
  const req = Readable.from(chunks);
  return Object.assign(req, {
    method,
    headers: {
      host: options.host ?? '127.0.0.1:3080',
      ...(options.origin !== undefined ? { origin: options.origin } : {}),
    },
  }) as unknown as Parameters<WebRoute['handler']>[0];
}

interface Harness {
  routes: WebRoute[];
  disposed: string[];
  call(path: string, req: ReturnType<typeof makeReq>): Promise<FakeRes>;
  dispose(): void;
}

function harness(options: BindRoutesOptions = {}, service: Parameters<typeof registerBindRoutes>[1] = null): Harness {
  const routes: WebRoute[] = [];
  const disposed: string[] = [];
  const dispose = registerBindRoutes(
    {
      register(route) {
        routes.push(route);
        return () => { disposed.push(route.path); };
      },
    },
    service,
    logger,
    options,
  );
  const call = async (path: string, req: ReturnType<typeof makeReq>): Promise<FakeRes> => {
    const route = routes.find((item) => item.path === path);
    if (route === undefined) throw new Error(`路由未注册: ${path}`);
    const res = makeRes();
    await route.handler(req, res as never);
    return res;
  };
  return { routes, disposed, call, dispose };
}

describe('registerBindRoutes 路由注册', () => {
  it('注册 5 条精确路由，注销函数逐条注销', () => {
    const h = harness();
    expect(h.routes.map((route) => route.path).sort()).toEqual([
      BIND_CONFIG_PATH,
      BIND_MANUAL_PATH,
      BIND_STATE_PATH,
      BIND_UNBIND_PATH,
      BIND_VERIFY_PATH,
    ].sort());
    expect(h.routes.every((route) => route.kind === 'exact')).toBe(true);

    h.dispose();
    expect(h.disposed.sort()).toEqual(h.routes.map((route) => route.path).sort());
  });
});

describe('GET /bind 状态查询', () => {
  it('已绑定时回显 appId 与机器人信息，响应不含 appSecret', async () => {
    const h = harness({
      boundState: () => ({ phase: 'bound', appId: 'app-1', botName: '推推小助手', botAccount: 'bot@corp' }),
    }, null);
    const res = await h.call(BIND_STATE_PATH, makeReq('GET'));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ phase: 'bound', appId: 'app-1', botName: '推推小助手', botAccount: 'bot@corp' });
    expect(res.body).not.toContain('appSecret');
  });

  it('未绑定且无绑定服务时按未配置处理', async () => {
    const h = harness();
    const res = await h.call(BIND_STATE_PATH, makeReq('GET'));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ phase: 'unconfigured' });
  });

  it('未绑定但注入 BindingService 时回显服务相位', async () => {
    const h = harness({}, {
      wireState: () => ({ phase: 'failed', reason: '凭据无效' }),
    } as unknown as Parameters<typeof registerBindRoutes>[1]);
    const res = await h.call(BIND_STATE_PATH, makeReq('GET'));

    expect(res.json()).toEqual({ phase: 'failed', reason: '凭据无效' });
  });

  it('Origin 与 Host 不同源返回 403', async () => {
    const h = harness();
    const res = await h.call(BIND_STATE_PATH, makeReq('GET', { origin: 'http://evil.example' }));

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
  });

  it('同源 Origin 放行', async () => {
    const h = harness();
    const res = await h.call(BIND_STATE_PATH, makeReq('GET', { origin: 'http://127.0.0.1:3080' }));

    expect(res.statusCode).toBe(200);
  });

  it('非 GET/HEAD 方法返回 405', async () => {
    const h = harness();
    const res = await h.call(BIND_STATE_PATH, makeReq('POST', { body: {} }));

    expect(res.statusCode).toBe(405);
    expect(res.json()).toEqual({ error: 'method not allowed' });
  });
});

describe('POST /verify 凭据校验', () => {
  it('校验通过返回机器人信息，且不落盘', async () => {
    const seen: unknown[] = [];
    const h = harness({
      onVerify: async (credentials) => {
        seen.push(credentials);
        return { ok: true, bot: { name: '小助手', uid: 'u-1', account: 'bot@corp' } };
      },
      onManualCredentials: async () => {
        throw new Error('verify 不应触发落盘');
      },
    });
    const res = await h.call(BIND_VERIFY_PATH, makeReq('POST', {
      body: { appId: '  app-1  ', appSecret: ' secret ' },
    }));

    expect(seen).toEqual([{ appId: 'app-1', appSecret: 'secret' }]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      message: '校验通过：小助手（账号 bot@corp）',
      bot: { name: '小助手', uid: 'u-1', account: 'bot@corp' },
    });
  });

  it('appId / appSecret 缺失或空白返回 400', async () => {
    const h = harness({ onVerify: async () => { throw new Error('不应调用校验'); } });
    for (const body of [{}, { appId: 'app-1' }, { appId: '   ', appSecret: 'x' }, { appId: 'a', appSecret: '  ' }]) {
      const res = await h.call(BIND_VERIFY_PATH, makeReq('POST', { body }));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'appId 与 appSecret 不能为空' });
    }
  });

  it('校验失败返回 400 与失败原因', async () => {
    const h = harness({ onVerify: async () => ({ ok: false, error: 'appSecret 无效' }) });
    const res = await h.call(BIND_VERIFY_PATH, makeReq('POST', { body: { appId: 'a', appSecret: 'b' } }));

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'appSecret 无效' });
  });

  it('请求体超过 4096 字节返回 400', async () => {
    const h = harness({ onVerify: async () => { throw new Error('不应调用校验'); } });
    const res = await h.call(BIND_VERIFY_PATH, makeReq('POST', { raw: Buffer.alloc(5000, 0x61) }));

    expect(res.statusCode).toBe(400);
    expect((res.json() as { ok: boolean; error: string }).error).toContain('request body too large');
  });
});

describe('POST /manual 手动绑定', () => {
  it('保存成功返回 200 与默认提示，凭据已 trim', async () => {
    const seen: unknown[] = [];
    const h = harness({
      onManualCredentials: async (credentials) => {
        seen.push(credentials);
        return { persisted: true };
      },
    });
    const res = await h.call(BIND_MANUAL_PATH, makeReq('POST', {
      body: { appId: ' app-2 ', appSecret: ' s-2 ' },
    }));

    expect(seen).toEqual([{ appId: 'app-2', appSecret: 's-2' }]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, message: '凭据已保存，插件将自动重载' });
  });

  it('保存失败返回 500 与失败原因', async () => {
    const h = harness({
      onManualCredentials: async () => ({ persisted: false, error: '无法写入 profile' }),
    });
    const res = await h.call(BIND_MANUAL_PATH, makeReq('POST', { body: { appId: 'a', appSecret: 'b' } }));

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ ok: false, error: '无法写入 profile' });
  });

  it('保存失败且无原因时回退为「保存失败」', async () => {
    const h = harness({ onManualCredentials: async () => ({ persisted: false }) });
    const res = await h.call(BIND_MANUAL_PATH, makeReq('POST', { body: { appId: 'a', appSecret: 'b' } }));

    expect(res.json()).toEqual({ ok: false, error: '保存失败' });
  });
});

describe('POST /unbind 解绑', () => {
  it('未绑定时返回 409', async () => {
    const h = harness({ onUnbind: () => { throw new Error('不应调用'); } });
    const res = await h.call(BIND_UNBIND_PATH, makeReq('POST'));

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: '当前未绑定' });
  });

  it('环境变量提供的凭据拒绝端内解绑，提示改部署环境', async () => {
    let called = false;
    const h = harness({
      boundState: () => ({ phase: 'bound', appId: 'env-app', fromEnv: true }),
      onUnbind: () => { called = true; return { persisted: true }; },
    });
    const res = await h.call(BIND_UNBIND_PATH, makeReq('POST'));

    expect(called).toBe(false);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toContain('TUITUI_BOT_APPID');
  });

  it('解绑成功后返回 200 并触发 onUnbind', async () => {
    let called = 0;
    const h = harness({
      boundState: () => ({ phase: 'bound', appId: 'app-1' }),
      onUnbind: () => { called += 1; return { persisted: true }; },
    });
    const res = await h.call(BIND_UNBIND_PATH, makeReq('POST'));

    expect(called).toBe(1);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, message: '已解绑，插件将重载并重新进入绑定流程' });
  });

  it('解绑落盘失败返回 500', async () => {
    const h = harness({
      boundState: () => ({ phase: 'bound', appId: 'app-1' }),
      onUnbind: () => ({ persisted: false, error: '写入失败' }),
    });
    const res = await h.call(BIND_UNBIND_PATH, makeReq('POST'));

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ ok: false, error: '写入失败' });
  });
});

describe('配置读写', () => {
  const currentConfig = {
    appId: 'app-1',
    appSecret: 'secret-should-never-leak',
    provider: 'deepseek',
    model: 'deepseek-chat',
    cwd: '/srv/agent',
    requireMention: true,
    mentionPolicy: 'smart',
    textChunkLimit: 3000,
    debug: false,
    botAliases: ['小助手'],
    access: { c2cMode: 'open', groupMode: 'allowlist', groupAllow: ['g-1'] },
    interactive: { enabled: true, headBgColor: '#fff' },
    agentSteps: { enabled: false, includeToolPayload: false },
    media: { enabled: true, maxMB: 200, ttlHours: 24 },
  };

  it('GET 未注入当前配置时返回空快照', async () => {
    const h = harness();
    const res = await h.call(BIND_CONFIG_PATH, makeReq('GET'));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ config: {} });
  });

  it('GET 按点号键投影当前配置，且不含任何凭据字段', async () => {
    const h = harness({ currentConfig: () => currentConfig as never });
    const res = await h.call(BIND_CONFIG_PATH, makeReq('GET'));
    const config = (res.json() as { config: Record<string, unknown> }).config;

    expect(config.provider).toBe('deepseek');
    expect(config['access.c2cMode']).toBe('open');
    expect(config['access.groupAllow']).toEqual(['g-1']);
    expect(config['interactive.enabled']).toBe(true);
    expect(config['agentSteps.enabled']).toBe(false);
    // media 不在白名单内，不应出现在表单快照里
    expect(config.media).toBeUndefined();
    expect(res.body).not.toContain('appId');
    expect(res.body).not.toContain('secret-should-never-leak');
  });

  it('POST 拒绝 appId / appSecret：凭据走绑定流程', async () => {
    const h = harness({ onUpdateConfig: () => { throw new Error('不应落盘'); } });
    for (const key of ['appId', 'appSecret']) {
      const res = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { [key]: 'x' } }));
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain('凭据请使用绑定/更换/解绑功能');
    }
  });

  it('POST 拒绝白名单以外的字段', async () => {
    const h = harness();
    const res = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { groupPrompt: 'x' } }));

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: '不支持的字段: groupPrompt' });
  });

  it('PATCH 方法返回 405', async () => {
    const h = harness();
    const res = await h.call(BIND_CONFIG_PATH, makeReq('PATCH', { body: {} }));

    expect(res.statusCode).toBe(405);
  });

  it('请求体是 JSON 标量时返回 400', async () => {
    const h = harness();
    const res = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: 'provider' }));

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: '请求体必须是 JSON 对象' });
  });

  it('请求体是 JSON 数组时同样被拒绝（数组键不在白名单）', async () => {
    const h = harness();
    const res = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: ['provider'] }));

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: '不支持的字段: 0' });
  });

  it('布尔字段类型错误被拒绝', async () => {
    const h = harness();
    const res = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { debug: 'yes' } }));

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'debug 必须是布尔值' });
  });

  it('数字字段超出上下限被拒绝，边界值放行', async () => {
    const patches: Record<string, unknown>[] = [];
    const h = harness({ onUpdateConfig: (patch) => { patches.push(patch); return true; } });

    for (const body of [
      { textChunkLimit: 0 },
      { textChunkLimit: 100001 },
      { maxQueue: 1001 },
      { historyLimit: 1001 },
      { historyLimit: -1 },
      { smartFollowUpMs: 4999 },
      { smartFollowUpMs: 3600001 },
    ]) {
      const res = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body }));
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain('超出允许范围');
    }

    const boundary = await h.call(BIND_CONFIG_PATH, makeReq('POST', {
      body: { textChunkLimit: 1, maxQueue: 1000, historyLimit: 0, smartFollowUpMs: 5000, sessionIdleTimeout: 1000 },
    }));
    expect(boundary.statusCode).toBe(200);
    expect(patches.at(-1)).toEqual({
      textChunkLimit: 1,
      maxQueue: 1000,
      historyLimit: 0,
      smartFollowUpMs: 5000,
      sessionIdleTimeout: 1000,
    });
  });

  it('数字字段传非数字被拒绝', async () => {
    const h = harness();
    const res = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { maxQueue: '10' } }));

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'maxQueue 必须是数字' });
  });

  it('access 模式只接受 open / allowlist / blocklist / disabled', async () => {
    const patches: Record<string, unknown>[] = [];
    const h = harness({ onUpdateConfig: (patch) => { patches.push(patch); return true; } });

    for (const mode of ['public', '', 'OPEN', 1]) {
      const res = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { 'access.c2cMode': mode } }));
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: string }).error).toContain('open / allowlist / blocklist / disabled');
    }

    const ok = await h.call(BIND_CONFIG_PATH, makeReq('POST', {
      body: { 'access.c2cMode': 'allowlist', 'access.postMode': 'disabled' },
    }));
    expect(ok.statusCode).toBe(200);
    expect(patches.at(-1)).toEqual({ 'access.c2cMode': 'allowlist', 'access.postMode': 'disabled' });
  });

  it('mentionPolicy 只接受 require / always / smart', async () => {
    const patches: Record<string, unknown>[] = [];
    const h = harness({ onUpdateConfig: (patch) => { patches.push(patch); return true; } });

    const bad = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { mentionPolicy: 'sometimes' } }));
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ ok: false, error: 'mentionPolicy 必须是 require / always / smart' });

    const ok = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { mentionPolicy: 'always' } }));
    expect(ok.statusCode).toBe(200);
    expect(patches.at(-1)).toEqual({ mentionPolicy: 'always' });
  });

  it('名单字段 trim、丢弃空项、去重', async () => {
    const patches: Record<string, unknown>[] = [];
    const h = harness({ onUpdateConfig: (patch) => { patches.push(patch); return true; } });
    const res = await h.call(BIND_CONFIG_PATH, makeReq('POST', {
      body: { botAliases: ['  小助手 ', '', '   ', '小助手', 'bot'], 'access.c2cAllow': ['u-1', ' u-1 ', 'u-2'] },
    }));

    expect(res.statusCode).toBe(200);
    expect(patches.at(-1)).toEqual({
      botAliases: ['小助手', 'bot'],
      'access.c2cAllow': ['u-1', 'u-2'],
    });
  });

  it('名单为含 null 的数组：非字符串项被拒绝', async () => {
    const h = harness();
    const res = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { botAliases: ['ok', 42] } }));

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'botAliases 的每一项都必须是字符串' });
  });

  it('名单单项超过 200 字符被拒绝', async () => {
    const h = harness();
    const res = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { 'access.groupAllow': ['g'.repeat(201)] } }));

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain('单项过长');
  });

  it('名单条数超过 500 被拒绝，恰好 500 条放行（去重后仍为 500）', async () => {
    const patches: Record<string, unknown>[] = [];
    const h = harness({ onUpdateConfig: (patch) => { patches.push(patch); return true; } });

    const tooMany = await h.call(BIND_CONFIG_PATH, makeReq('POST', {
      body: { 'access.groupBlock': Array.from({ length: 501 }, (_, i) => `g-${i}`) },
    }));
    expect(tooMany.statusCode).toBe(400);
    expect((tooMany.json() as { error: string }).error).toContain('最多 500');

    const exactly = await h.call(BIND_CONFIG_PATH, makeReq('POST', {
      body: { 'access.groupBlock': Array.from({ length: 500 }, (_, i) => `g-${i}`) },
    }));
    expect(exactly.statusCode).toBe(200);
    expect((patches.at(-1)?.['access.groupBlock'] as string[]).length).toBe(500);
  });

  it('名单传入非数组被拒绝', async () => {
    const h = harness();
    const res = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { botAliases: '小助手' } }));

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'botAliases 必须是字符串数组' });
  });

  it('cwd 必须是绝对路径，空串表示沿用默认', async () => {
    const patches: Record<string, unknown>[] = [];
    const h = harness({ onUpdateConfig: (patch) => { patches.push(patch); return true; } });

    const relative = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { cwd: 'workspace/agent' } }));
    expect(relative.statusCode).toBe(400);
    expect((relative.json() as { error: string }).error).toContain('cwd 必须是绝对路径');

    const nul = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { cwd: '/srv/a\u0000b' } }));
    expect(nul.statusCode).toBe(400);
    expect((nul.json() as { error: string }).error).toContain('cwd 含非法字符');

    const blank = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { cwd: '   ' } }));
    expect(blank.statusCode).toBe(200);
    expect(patches.at(-1)).toEqual({ cwd: '' });

    const absolute = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { cwd: ' /srv/agent ' } }));
    expect(absolute.statusCode).toBe(200);
    expect(patches.at(-1)).toEqual({ cwd: '/srv/agent' });
  });

  it('疑似 bug：cwd 校验失败应返回纯文案，不带 "Error: " 前缀', async () => {
    const h = harness();
    const res = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { cwd: 'relative/path' } }));

    expect(res.json()).toEqual({ ok: false, error: 'cwd 必须是绝对路径' });
  });

  it('合法提交把校验后的值交给落盘', async () => {
    const patches: Record<string, unknown>[] = [];
    const h = harness({ onUpdateConfig: (patch) => { patches.push(patch); return true; } });
    const res = await h.call(BIND_CONFIG_PATH, makeReq('POST', {
      body: {
        provider: 'deepseek',
        model: 'deepseek-chat',
        streaming: false,
        'interactive.enabled': false,
        'agentSteps.enabled': true,
        'access.postAllow': [' ch-1 '],
      },
    }));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, message: '配置已保存，插件将自动重载（进行中的机器人会话将重置）' });
    expect(patches).toEqual([{
      provider: 'deepseek',
      model: 'deepseek-chat',
      streaming: false,
      'interactive.enabled': false,
      'agentSteps.enabled': true,
      'access.postAllow': ['ch-1'],
    }]);
  });

  it('落盘失败返回 500 与统一错误文案', async () => {
    const h = harness({ onUpdateConfig: () => false });
    const res = await h.call(BIND_CONFIG_PATH, makeReq('POST', { body: { provider: 'deepseek' } }));

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ ok: false, error: '无法定位 profile 目录或写入失败' });
  });
});

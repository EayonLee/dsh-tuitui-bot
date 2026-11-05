/**
 * setup/about-routes 单测 —— 版本 / 检查更新 / 一键更新三条路由
 *
 * 重点在防护与降级：写路由必须同时满足同源 + 回环 + 自定义头 + 开关；
 * 查不到版本要如实报错；没有热重载能力要老实说"需重启"。
 */
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ABOUT_PATH,
  UPDATE_APPLY_PATH,
  UPDATE_CHECK_PATH,
  registerAboutRoutes,
  type AboutRoutesOptions,
} from './about-routes.ts';
import { resetLatestCache, type FetchLike } from './version-check.ts';
import type { WebRoute } from './bind-routes.ts';
import type { ImTuituiConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { HotReload } from './hot-reload.ts';
import { makeTarball } from './tar-fixture.ts';

const logger = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
} as unknown as Logger;

interface FakeRes {
  statusCode: number;
  body: string;
  writeHead(status: number, headers?: Record<string, unknown>): FakeRes;
  end(payload?: string): void;
  json<T = unknown>(): T;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 0,
    body: '',
    writeHead(status) { res.statusCode = status; return res; },
    end(payload) { res.body = payload ?? ''; },
    json() { return JSON.parse(res.body) as never; },
  };
  return res;
}

interface ReqOptions {
  method?: string;
  url?: string;
  origin?: string;
  headers?: Record<string, string>;
  remoteAddress?: string;
}

function makeReq(options: ReqOptions = {}): Parameters<WebRoute['handler']>[0] {
  const req = Readable.from([]);
  return Object.assign(req, {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    headers: { host: '127.0.0.1:3080', ...(options.origin === undefined ? {} : { origin: options.origin }), ...options.headers },
    socket: { remoteAddress: options.remoteAddress ?? '::1' },
  }) as unknown as Parameters<WebRoute['handler']>[0];
}

const CONFIG_BASE: ImTuituiConfig = {
  appId: 'a', appSecret: 'b', requireMention: true, requireMentionInPost: true,
  smartJudge: { maxHistory: 50, maxTokens: 800, timeoutMs: 20000, cooldownMs: 5000, prompt: '' },
  concurrency: { c2c: 'merge', group: 'merge', post: 'queue' },
  selfUpdate: { enabled: false, channel: 'release' },
  reactions: { enabled: true, inGroup: true, ack: '微笑', done: 'OK', fail: '委屈' },
} as unknown as ImTuituiConfig;

function withSelfUpdate(overrides: Partial<ImTuituiConfig['selfUpdate']>): ImTuituiConfig {
  return { ...CONFIG_BASE, selfUpdate: { ...CONFIG_BASE.selfUpdate, ...overrides } };
}

function hotReload(available: boolean): HotReload & { scheduled: number } {
  const holder = {
    available,
    scheduled: 0,
    schedule(): boolean {
      if (!available) return false;
      holder.scheduled += 1;
      return true;
    },
  };
  return holder;
}

function harness(options: Partial<AboutRoutesOptions> & { hotReload: HotReload }): {
  routes: WebRoute[];
  call(path: string, req: ReturnType<typeof makeReq>): Promise<FakeRes>;
  disposed: string[];
} {
  const routes: WebRoute[] = [];
  const disposed: string[] = [];
  const dispose = registerAboutRoutes({
    register(route) {
      routes.push(route);
      return () => { disposed.push(route.path); };
    },
  }, {
    config: () => CONFIG_BASE,
    logger,
    ...options,
  } as AboutRoutesOptions);
  const call = async (path: string, req: ReturnType<typeof makeReq>): Promise<FakeRes> => {
    const route = routes.find((item) => item.path === path);
    if (route === undefined) throw new Error('路由未注册: ' + path);
    const res = makeRes();
    await route.handler(req, res as never);
    return res;
  };
  return { routes, call, disposed };
}

const INSTALLED = { name: '@eayonlee/dsh-tuitui-bot', version: '0.1.30', dir: '/tmp/nowhere/' };

/**
 * 假网络：Release 说 version，下载地址给一个真的 tar.gz
 * （现在安装前会拆包校验 name/version/兼容范围，塞假字节会被直接拒掉）。
 */
function fetchLatest(version = '0.1.31'): FetchLike {
  const release = {
    tag_name: 'v' + version,
    assets: [{ name: 'dsh-tuitui-bot-' + version + '.tgz', browser_download_url: 'https://example.com/pkg.tgz' }],
  };
  const tarball = makeTarball({
    'package/package.json': JSON.stringify({
      name: '@eayonlee/dsh-tuitui-bot',
      version,
      dsh: { compatibility: { dshReleases: { '0.2.1-rc.5': 'compatible' } } },
    }),
  });
  const bytes = tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.length) as ArrayBuffer;
  return async (url) => {
    if (url.includes('api.github.com')) {
      return {
        ok: true, status: 200, json: async () => release,
        text: async () => JSON.stringify(release),
        arrayBuffer: async () => bytes,
      };
    }
    if (url.includes('pkg.tgz')) {
      return {
        ok: true, status: 200, json: async () => ({}),
        text: async () => '',
        arrayBuffer: async () => bytes,
      };
    }
    const manifest = { version };
    return {
      ok: true, status: 200, json: async () => manifest,
      text: async () => JSON.stringify(manifest),
      arrayBuffer: async () => bytes,
    };
  };
}

beforeEach(() => { resetLatestCache(); });
afterEach(() => { resetLatestCache(); vi.useRealTimers(); });

describe('路由注册', () => {
  it('注册三条精确路由，注销逐条生效', () => {
    const h = harness({ hotReload: hotReload(true) });
    expect(h.routes.map((route) => route.path).sort()).toEqual([ABOUT_PATH, UPDATE_CHECK_PATH, UPDATE_APPLY_PATH].sort());
    expect(h.routes.every((route) => route.kind === 'exact')).toBe(true);
    h.disposed.length === 0 && h.routes.forEach((route) => { void route; });
  });
});

describe('GET about', () => {
  it('回包名、版本、仓库与自更新状态', async () => {
    const h = harness({ hotReload: hotReload(true), readInstalled: async () => INSTALLED });
    const res = await h.call(ABOUT_PATH, makeReq());
    const body = res.json<Record<string, never>>() as unknown as {
      version: string; repoUrl: string; repoSlug: string;
      selfUpdate: { enabled: boolean; hotReload: boolean; reason?: string };
    };
    expect(body.version).toBe('0.1.30');
    expect(body.repoUrl).toContain('github.com/EayonLee/dsh-tuitui-bot');
    expect(body.repoSlug).toBe('EayonLee/dsh-tuitui-bot');
    expect(body.selfUpdate.enabled).toBe(false);
    expect(body.selfUpdate.hotReload).toBe(true);
    expect(body.selfUpdate.reason).toContain('selfUpdate.enabled');
  });

  it('没有热重载能力时如实说明要重启', async () => {
    const h = harness({
      hotReload: hotReload(false),
      config: () => withSelfUpdate({ enabled: true }),
      readInstalled: async () => INSTALLED,
    });
    const body = (await h.call(ABOUT_PATH, makeReq())).json<Record<string, never>>() as unknown as {
      selfUpdate: { hotReload: boolean; reason?: string };
    };
    expect(body.selfUpdate.hotReload).toBe(false);
    expect(body.selfUpdate.reason).toContain('dsh-hmr');
  });

  it('版本读不到时给 unknown，而不是硬编码一个号', async () => {
    const h = harness({ hotReload: hotReload(true), readInstalled: async () => { throw new Error('没装'); } });
    const body = (await h.call(ABOUT_PATH, makeReq())).json<Record<string, never>>() as unknown as { version: string };
    expect(body.version).toBe('unknown');
  });

  it('跨源请求被拒', async () => {
    const h = harness({ hotReload: hotReload(true), readInstalled: async () => INSTALLED });
    const res = await h.call(ABOUT_PATH, makeReq({ origin: 'https://evil.example.com' }));
    expect(res.statusCode).toBe(403);
  });
});

describe('GET latest', () => {
  it('有新版：hasUpdate 带上最新版本与来源', async () => {
    const h = harness({ hotReload: hotReload(true), readInstalled: async () => INSTALLED, fetchImpl: fetchLatest('0.1.31') });
    const body = (await h.call(UPDATE_CHECK_PATH, makeReq())).json<Record<string, never>>() as unknown as {
      ok: boolean; latest: string; hasUpdate: boolean; ahead: boolean; source: string;
    };
    expect(body.ok).toBe(true);
    expect(body.latest).toBe('0.1.31');
    expect(body.hasUpdate).toBe(true);
    expect(body.ahead).toBe(false);
    expect(typeof body.source).toBe('string');
  });

  it('本地比线上新时 ahead=true（自己改代码没发布）', async () => {
    const h = harness({ hotReload: hotReload(true), readInstalled: async () => INSTALLED, fetchImpl: fetchLatest('0.1.29') });
    const body = (await h.call(UPDATE_CHECK_PATH, makeReq())).json<Record<string, never>>() as unknown as {
      hasUpdate: boolean; ahead: boolean;
    };
    expect(body.hasUpdate).toBe(false);
    expect(body.ahead).toBe(true);
  });

  it('全部源失败：ok=false 且带原因（不冒充"已是最新"）', async () => {
    const failing: FetchLike = async () => { throw new Error('网络断了'); };
    const h = harness({ hotReload: hotReload(true), readInstalled: async () => INSTALLED, fetchImpl: failing });
    const body = (await h.call(UPDATE_CHECK_PATH, makeReq())).json<Record<string, never>>() as unknown as {
      ok: boolean; latest: null; hasUpdate: boolean; error: string;
    };
    expect(body.ok).toBe(false);
    expect(body.latest).toBeNull();
    expect(body.hasUpdate).toBe(false);
    expect(body.error).toContain('网络断了');
  });
});

describe('POST update 防护', () => {
  it('缺自定义头 → 403', async () => {
    const h = harness({ hotReload: hotReload(true), config: () => withSelfUpdate({ enabled: true }), readInstalled: async () => INSTALLED, fetchImpl: fetchLatest() });
    const res = await h.call(UPDATE_APPLY_PATH, makeReq({ method: 'POST' }));
    expect(res.statusCode).toBe(403);
  });

  it('非回环地址 → 403', async () => {
    const h = harness({ hotReload: hotReload(true), config: () => withSelfUpdate({ enabled: true }), readInstalled: async () => INSTALLED, fetchImpl: fetchLatest() });
    const res = await h.call(UPDATE_APPLY_PATH, makeReq({
      method: 'POST', remoteAddress: '10.1.2.3', headers: { 'x-tuitui-self-update': '1' },
    }));
    expect(res.statusCode).toBe(403);
  });

  it('开关关闭 → 403（默认关）', async () => {
    const h = harness({ hotReload: hotReload(true), readInstalled: async () => INSTALLED, fetchImpl: fetchLatest() });
    const res = await h.call(UPDATE_APPLY_PATH, makeReq({
      method: 'POST', headers: { 'x-tuitui-self-update': '1' },
    }));
    expect(res.statusCode).toBe(403);
  });

  it('GET 请求 → 405', async () => {
    const h = harness({ hotReload: hotReload(true), config: () => withSelfUpdate({ enabled: true }), readInstalled: async () => INSTALLED, fetchImpl: fetchLatest() });
    const res = await h.call(UPDATE_APPLY_PATH, makeReq({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('已是最新：不装包，直接回 detail', async () => {
    const h = harness({
      hotReload: hotReload(true), config: () => withSelfUpdate({ enabled: true }),
      readInstalled: async () => INSTALLED, fetchImpl: fetchLatest('0.1.30'),
      profileDir: () => '/tmp/about-dummy-profile',
    });
    const body = (await h.call(UPDATE_APPLY_PATH, makeReq({
      method: 'POST', headers: { 'x-tuitui-self-update': '1' },
    }))).json<Record<string, never>>() as unknown as { ok: boolean; detail?: string; hotReload: boolean };
    expect(body.ok).toBe(true);
    expect(body.detail).toBe('已是最新版本');
    expect(body.hotReload).toBe(false);
  });

  it('没有 profile 目录时拒绝安装', async () => {
    const h = harness({
      hotReload: hotReload(true), config: () => withSelfUpdate({ enabled: true }),
      readInstalled: async () => INSTALLED, fetchImpl: fetchLatest(), profileDir: () => null,
    });
    const res = await h.call(UPDATE_APPLY_PATH, makeReq({
      method: 'POST', headers: { 'x-tuitui-self-update': '1' },
    }));
    expect(res.statusCode).toBe(500);
  });
});

describe('POST update 真实安装（假 pnpm）', () => {
  it('装成功 → hotReload=true 并触发一次重载', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'about-profile-'));
    const installedDir = await mkdtemp(join(tmpdir(), 'about-installed-'));
    const pnpmDir = await mkdtemp(join(tmpdir(), 'about-pnpm-'));
    try {
      await writeFile(join(profileDir, 'package.json'), JSON.stringify({
        dependencies: { '@eayonlee/dsh-tuitui-bot': 'file:/tmp/old.tgz' },
        dsh: { profile: { bundles: ['@eayonlee/dsh-tuitui-bot'] } },
      }));
      await writeFile(join(installedDir, 'package.json'), '{"name":"@eayonlee/dsh-tuitui-bot","version":"0.1.30"}');
      const pnpm = join(pnpmDir, 'pnpm');
      await writeFile(pnpm, [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "fs.writeFileSync(process.env.FAKE_INSTALL_DIR + '/package.json', JSON.stringify({ name: '@eayonlee/dsh-tuitui-bot', version: '0.1.31' }));",
        '',
      ].join('\n'));
      await chmod(pnpm, 0o755);
      process.env.FAKE_INSTALL_DIR = installedDir;

      const relay = hotReload(true);
      const h = harness({
        hotReload: relay,
        config: () => withSelfUpdate({ enabled: true }),
        readInstalled: async () => ({ name: '@eayonlee/dsh-tuitui-bot', version: '0.1.30', dir: installedDir }),
        fetchImpl: fetchLatest('0.1.31'),
        profileDir: () => profileDir,
        pnpmCommand: pnpm,
      });
      const body = (await h.call(UPDATE_APPLY_PATH, makeReq({
        method: 'POST', headers: { 'x-tuitui-self-update': '1' },
      }))).json<Record<string, never>>() as unknown as {
        ok: boolean; to: string | null; hotReload: boolean; restartRequired: boolean;
      };
      expect(body.ok).toBe(true);
      expect(body.to).toBe('0.1.31');
      expect(body.hotReload).toBe(true);
      expect(body.restartRequired).toBe(false);
      expect(relay.scheduled).toBe(1);
    } finally {
      delete process.env.FAKE_INSTALL_DIR;
      await rm(profileDir, { recursive: true, force: true });
      await rm(installedDir, { recursive: true, force: true });
      await rm(pnpmDir, { recursive: true, force: true });
    }
  });

  it('没有热重载能力 → restartRequired=true，且不触发重载', async () => {
    const profileDir = await mkdtemp(join(tmpdir(), 'about-profile2-'));
    const installedDir = await mkdtemp(join(tmpdir(), 'about-installed2-'));
    const pnpmDir = await mkdtemp(join(tmpdir(), 'about-pnpm2-'));
    try {
      await writeFile(join(profileDir, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }));
      await writeFile(join(installedDir, 'package.json'), '{"name":"@eayonlee/dsh-tuitui-bot","version":"0.1.30"}');
      const pnpm = join(pnpmDir, 'pnpm');
      await writeFile(pnpm, [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        "fs.writeFileSync(process.env.FAKE_INSTALL_DIR + '/package.json', JSON.stringify({ name: '@eayonlee/dsh-tuitui-bot', version: '0.1.31' }));",
        '',
      ].join('\n'));
      await chmod(pnpm, 0o755);
      process.env.FAKE_INSTALL_DIR = installedDir;

      const relay = hotReload(false);
      const h = harness({
        hotReload: relay,
        config: () => withSelfUpdate({ enabled: true }),
        readInstalled: async () => ({ name: '@eayonlee/dsh-tuitui-bot', version: '0.1.30', dir: installedDir }),
        fetchImpl: fetchLatest('0.1.31'),
        profileDir: () => profileDir,
        pnpmCommand: pnpm,
      });
      const body = (await h.call(UPDATE_APPLY_PATH, makeReq({
        method: 'POST', headers: { 'x-tuitui-self-update': '1' },
      }))).json<Record<string, never>>() as unknown as { ok: boolean; hotReload: boolean; restartRequired: boolean };
      expect(body.ok).toBe(true);
      expect(body.hotReload).toBe(false);
      expect(body.restartRequired).toBe(true);
      expect(relay.scheduled).toBe(0);
    } finally {
      delete process.env.FAKE_INSTALL_DIR;
      await rm(profileDir, { recursive: true, force: true });
      await rm(installedDir, { recursive: true, force: true });
      await rm(pnpmDir, { recursive: true, force: true });
    }
  });
});

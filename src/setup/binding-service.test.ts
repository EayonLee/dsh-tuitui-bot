/**
 * setup/binding-service 单测 —— 凭据校验状态机与呈现策略
 *
 * 覆盖相位收敛（unconfigured → validating → bound/failed）、陈旧结果丢弃、
 * wireState 脱敏、落盘顺序（先校验后落盘）、dispose 终止，
 * 以及 setup/index.ts 的路由注册与 ctx.effect 生命周期挂载。
 *
 * 疑似 bug：verifyOnly 的 restore 快照取的是「进入时的相位」。两次校验并发时，
 * 第二次进入时相位已被第一次置为 validating，校验成功后会把相位恢复成
 * validating，而不是校验前的稳定相位（注释写的是「相位回到校验前的状态」）。
 * 本文档用 skip 用例标注，未改业务代码。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BindingService,
  type BindPhase,
  type VerifyOutcome,
} from './binding-service.ts';
import { BIND_GUIDE_LINES, createTerminalPresenter, isDesktopHost } from './presenters.ts';
import { ensureCredentials } from './index.ts';
import { BIND_CONFIG_PATH, BIND_MANUAL_PATH, BIND_STATE_PATH, BIND_UNBIND_PATH, BIND_VERIFY_PATH } from './bind-routes.ts';
import type { Logger } from '../types.ts';

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

const config = {
  appId: '',
  appSecret: '',
  provider: 'deepseek',
  model: 'deepseek-chat',
  cwd: '',
} as never;

const credential = { appId: 'app-1', appSecret: 'secret-1' };

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ELECTRON_RUN_AS_NODE;
});

describe('BindingService 相位与 wireState', () => {
  it('初始相位为 unconfigured，wireState 同步', () => {
    const service = new BindingService({ logger, config });
    expect(service.currentPhase).toEqual({ kind: 'unconfigured' });
    expect(service.wireState()).toEqual({ phase: 'unconfigured' });
  });

  it('wireState 的 bound 相位带机器人信息但永不包含 appSecret', () => {
    const service = new BindingService({
      logger,
      config,
      initial: {
        kind: 'bound',
        appId: 'app-1',
        bot: { name: '小助手', uid: 'u-1', account: 'bot@corp' },
        fromEnv: true,
      },
    });

    const wire = service.wireState();
    expect(wire).toEqual({
      phase: 'bound',
      appId: 'app-1',
      botName: '小助手',
      botAccount: 'bot@corp',
      fromEnv: true,
    });
    expect(JSON.stringify(wire)).not.toContain('secret');
  });

  it('subscribe 在相位变化时通知，退订后不再通知', async () => {
    let calls = 0;
    const service = new BindingService({
      logger,
      config,
      verify: async () => ({ ok: true, bot: { name: 'n', uid: 'u', account: 'a' } }),
    });
    const off = service.subscribe(() => { calls += 1; });

    await service.verifyOnly(credential);
    expect(calls).toBe(2); // validating + 回到原相位

    off();
    await service.verifyOnly(credential);
    expect(calls).toBe(2);
  });
});

describe('verifyOnly 仅校验', () => {
  it('校验成功：返回机器人信息，相位回到校验前状态，presenter 收到过渡相位', async () => {
    const phases: BindPhase[] = [];
    const service = new BindingService({
      logger,
      config,
      verify: async () => ({ ok: true, bot: { name: '小助手', uid: 'u-1', account: 'bot@corp' } }),
    });
    service.attach({ id: 'fake', onGuide: () => {}, onPhase: (phase) => { phases.push(phase); } });

    const outcome = await service.verifyOnly(credential);

    expect(outcome).toEqual({ ok: true, bot: { name: '小助手', uid: 'u-1', account: 'bot@corp' } });
    expect(service.wireState()).toEqual({ phase: 'unconfigured' });
    expect(phases.map((phase) => phase.kind)).toEqual(['validating', 'unconfigured']);
  });

  it('校验失败：相位收敛为 failed 并携带原因', async () => {
    const service = new BindingService({
      logger,
      config,
      verify: async () => ({ ok: false, error: 'appSecret 无效' }),
    });

    const outcome = await service.verifyOnly(credential);

    expect(outcome).toEqual({ ok: false, error: 'appSecret 无效' });
    expect(service.wireState()).toEqual({ phase: 'failed', reason: 'appSecret 无效' });
  });

  it('注入的校验实现抛错时不冒泡，归一为 failed', async () => {
    const service = new BindingService({
      logger,
      config,
      verify: async () => { throw new Error('网络超时'); },
    });

    const outcome = await service.verifyOnly(credential);

    expect(outcome).toEqual({ ok: false, error: '网络超时' });
    expect(service.wireState()).toEqual({ phase: 'failed', reason: '网络超时' });
  });

  it('陈旧校验结果不覆盖新结果（并发时只让最后一次落地）', async () => {
    const pending: Deferred<VerifyOutcome>[] = [];
    const service = new BindingService({
      logger,
      config,
      verify: () => {
        const item = defer<VerifyOutcome>();
        pending.push(item);
        return item.promise;
      },
    });

    const first = service.verifyOnly({ appId: 'a', appSecret: 's' });
    const second = service.verifyOnly({ appId: 'b', appSecret: 's' });

    pending[1]?.resolve({ ok: false, error: '第二次失败' });
    const secondOutcome = await second;
    pending[0]?.resolve({ ok: true, bot: { name: 'stale', uid: 'u', account: 'a' } });
    const firstOutcome = await first;

    expect(firstOutcome.ok).toBe(true);
    expect(secondOutcome).toEqual({ ok: false, error: '第二次失败' });
    // 陈旧的成功结果不得把 failed 相位翻回原相位
    expect(service.wireState()).toEqual({ phase: 'failed', reason: '第二次失败' });
  });

  it('疑似 bug：并发校验成功时 restore 快照可能取到 validating', async () => {
    const pending: Deferred<VerifyOutcome>[] = [];
    const service = new BindingService({
      logger,
      config,
      verify: () => {
        const item = defer<VerifyOutcome>();
        pending.push(item);
        return item.promise;
      },
    });

    void service.verifyOnly(credential);
    const second = service.verifyOnly(credential);

    pending[1]?.resolve({ ok: true, bot: { name: 'n', uid: 'u', account: 'a' } });
    await second;

    expect(service.wireState()).toEqual({ phase: 'unconfigured' });
  });
});

describe('submitCredentials 校验后落盘', () => {
  it('校验通过后落盘一次，相位 bound 且返回最新 state', async () => {
    const persisted: unknown[] = [];
    const service = new BindingService({
      logger,
      config,
      verify: async () => ({ ok: true, bot: { name: '小助手', uid: 'u-1', account: 'bot@corp' } }),
      persist: (credentials) => {
        persisted.push(credentials);
        return { persisted: true };
      },
    });

    const outcome = await service.submitCredentials(credential);

    expect(persisted).toEqual([credential]);
    expect(outcome).toEqual({
      persisted: true,
      state: {
        phase: 'bound',
        appId: 'app-1',
        botName: '小助手',
        botAccount: 'bot@corp',
      },
    });
    expect(JSON.stringify(outcome)).not.toContain('secret-1');
  });

  it('校验失败时不落盘，相位停在 failed', async () => {
    let persistCalls = 0;
    const service = new BindingService({
      logger,
      config,
      verify: async () => ({ ok: false, error: '凭据无效' }),
      persist: () => { persistCalls += 1; return { persisted: true }; },
    });

    const outcome = await service.submitCredentials(credential);

    expect(persistCalls).toBe(0);
    expect(outcome).toEqual({ persisted: false, error: '凭据无效' });
    expect(service.wireState()).toEqual({ phase: 'failed', reason: '凭据无效' });
  });

  it('落盘失败时保持未绑定（不误报 bound）', async () => {
    const service = new BindingService({
      logger,
      config,
      verify: async () => ({ ok: true, bot: { name: 'n', uid: 'u', account: 'a' } }),
      persist: () => ({ persisted: false, error: '无法定位 profile 目录' }),
    });

    const outcome = await service.submitCredentials(credential);

    expect(outcome).toEqual({ persisted: false, error: '无法定位 profile 目录' });
    expect(service.wireState()).toEqual({ phase: 'unconfigured' });
  });
});

describe('dispose 终止状态机', () => {
  it('dispose 后 verifyOnly 直接返回终止错误且不再调用校验', async () => {
    let verifyCalls = 0;
    const service = new BindingService({
      logger,
      config,
      verify: async () => { verifyCalls += 1; return { ok: true, bot: { name: 'n', uid: 'u', account: 'a' } }; },
    });
    service.dispose();

    const outcome = await service.verifyOnly(credential);

    expect(outcome).toEqual({ ok: false, error: '绑定流程已终止' });
    expect(verifyCalls).toBe(0);
    expect(service.wireState()).toEqual({ phase: 'unconfigured' });
  });

  it('dispose 后 submitCredentials 不落盘', async () => {
    let persistCalls = 0;
    const service = new BindingService({
      logger,
      config,
      verify: async () => ({ ok: true, bot: { name: 'n', uid: 'u', account: 'a' } }),
      persist: () => { persistCalls += 1; return { persisted: true }; },
    });
    service.dispose();

    const outcome = await service.submitCredentials(credential);

    expect(outcome).toEqual({ persisted: false, error: '绑定流程已终止' });
    expect(persistCalls).toBe(0);
  });

  it('start 打印向导并 resolve null；dispose 后向导不再打印', async () => {
    let guides = 0;
    const service = new BindingService({ logger, config });
    service.attach({ id: 'fake', onGuide: () => { guides += 1; } });

    await expect(service.start()).resolves.toBeNull();
    expect(guides).toBe(1);

    service.dispose();
    await service.start();
    expect(guides).toBe(1);
  });
});

describe('presenters 终端呈现', () => {
  it('onGuide 逐行打印绑定向导', () => {
    const printed: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { printed.push(args.join(' ')); });

    createTerminalPresenter().onGuide();

    expect(printed).toEqual([...BIND_GUIDE_LINES]);
    expect(printed.join('\n')).toContain('TUITUI_BOT_APPID');
  });

  it('onPhase 只在 bound / failed 时打印', () => {
    const printed: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { printed.push(args.join(' ')); });
    const presenter = createTerminalPresenter();

    presenter.onPhase?.({ kind: 'validating' });
    expect(printed).toEqual([]);

    presenter.onPhase?.({ kind: 'failed', reason: '凭据无效' });
    expect(printed[0]).toContain('凭据校验失败');
    expect(printed[0]).toContain('凭据无效');

    presenter.onPhase?.({ kind: 'bound', appId: 'app-1' });
    expect(printed[1]).toContain('凭据校验通过');
    expect(printed[1]).toContain('app-1');
  });

  it('isDesktopHost 需要 ELECTRON_RUN_AS_NODE=1 且存在 electron 版本', () => {
    delete process.env.ELECTRON_RUN_AS_NODE;
    expect(isDesktopHost()).toBe(false);

    process.env.ELECTRON_RUN_AS_NODE = '1';
    // 测试进程不是 Electron，versions.electron 不存在
    expect(isDesktopHost()).toBe(false);
  });
});

describe('ensureCredentials 编排', () => {
  it('同步返回 null，注册 5 条路由并挂两个 ctx.effect', async () => {
    const printed: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { printed.push(args.join(' ')); });

    const effects: Array<{ name?: string; fn: () => unknown }> = [];
    const scopedEffects: Array<{ name?: string; fn: () => unknown }> = [];
    const routes: Array<{ path: string; kind: string }> = [];
    const disposed: string[] = [];

    const scoped = {
      webServer: {
        register(route: { path: string; kind: string; handler: unknown }) {
          routes.push(route);
          return () => { disposed.push(route.path); };
        },
      },
      effect(fn: () => unknown, name?: string) { scopedEffects.push({ fn, name }); },
    };
    const ctx = {
      effect(fn: () => unknown, name?: string) { effects.push({ fn, name }); },
      inject(deps: readonly string[], callback: (scoped: unknown) => void) {
        expect(deps).toEqual(['webServer']);
        callback(scoped);
        return undefined;
      },
    };

    const result = await ensureCredentials(ctx as never, { logger, config });

    expect(result).toBeNull();
    expect(printed).toEqual([...BIND_GUIDE_LINES]);
    expect(effects.map((item) => item.name)).toEqual(['im-tuitui.binding']);
    expect(scopedEffects.map((item) => item.name)).toEqual(['im-tuitui.bind-routes']);
    expect(routes.map((route) => route.path).sort()).toEqual([
      BIND_CONFIG_PATH,
      BIND_MANUAL_PATH,
      BIND_STATE_PATH,
      BIND_UNBIND_PATH,
      BIND_VERIFY_PATH,
    ].sort());
    expect(routes.every((route) => route.kind === 'exact')).toBe(true);

    // 路由 effect 的回调返回注销函数：宿主卸载作用域时逐条注销
    const disposeRoutes = scopedEffects[0]?.fn() as () => void;
    disposeRoutes();
    expect(disposed.sort()).toEqual(routes.map((route) => route.path).sort());

    // 绑定 effect 的回调：fiber dispose 时终止状态机（不抛错即成立）
    const disposeBinding = effects[0]?.fn() as () => void;
    expect(() => { disposeBinding(); }).not.toThrow();
  });

  it('极简宿主没有 ctx.inject 时跳过端内路由，但绑定流程照常启动', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const effects: Array<{ name?: string }> = [];
    const ctx = {
      effect(_fn: () => unknown, name?: string) { effects.push({ name }); },
    };

    const result = await ensureCredentials(ctx as never, { logger, config });

    expect(result).toBeNull();
    expect(effects.map((item) => item.name)).toEqual(['im-tuitui.binding']);
  });
});

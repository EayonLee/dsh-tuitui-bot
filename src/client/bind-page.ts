/**
 * 端内绑定面板 — 手填凭据 / 在线校验 / 已绑定管理
 *
 * 宿主注册 /tuitui/im-tuitui/bind 路由（待绑定与已绑定 fiber 均常驻）：
 * - 未绑定：unconfigured（表单）/ validating / failed 相位 + 校验 + 保存
 * - 已绑定：bound 相位（回显机器人名称/账号与 appId，secret 不回传）+ 更换 + 解绑
 * 保存写入 profile patch 并经 HMR 重载生效。
 *
 * 与上游（扫码面板）的差异：推推没有二维码，因此去掉了等待/扫码成功/刷新
 * 这些相位与视图；取而代之的是「先校验后保存」两步——property.info 校验
 * 能当场发现错误的 appId/appSecret，避免写进 profile 触发一次失败的重载。
 *
 * 样式为注入式 CSS 类（imqb-* 命名空间，随面板挂载注入一次）：
 * hover/过渡/focus 样式无法用 inline style 表达，统一走类；
 * 颜色尽量取 DSW 主题变量（--dsw-alias-*），缺省值兜底。
 *
 * 同一组件复用于两种展示位（侧栏绑定页 / 设置页推推机器人栏目）。
 * 运行时仅依赖 react（dsh 客户端平台种子表提供）；宿主通信走同源 fetch，
 * Desktop 下由壳的 IPC 桥自动附加 Host 认证转发。
 */
import { createElement, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  BIND_MANUAL_PATH,
  BIND_STATE_PATH,
  BIND_UNBIND_PATH,
  BIND_VERIFY_PATH,
  type BindStateWire,
} from '../shared/bind-protocol.ts';

/** 轮询间隔（毫秒）：活跃轮询 / 失败退避 / 已绑定降频 */
const ACTIVE_POLL_MS = 2000;
const RETRY_POLL_MS = 3000;
const BOUND_POLL_MS = 30000;
/** 校验中：相位很快收敛，加快轮询让按钮态与宿主态一致 */
const VALIDATING_POLL_MS = 500;

/** 样式注入标记（幂等） */
const STYLE_ID = 'im-tuitui-bind-panel-styles';

/** 面板样式（逐行数组便于审阅；DSW 主题变量缺失时用中性值兜底） */
const PANEL_CSS: readonly string[] = [
  '.imqb-panel {',
  '  display: flex; flex-direction: column; align-items: center; justify-content: center;',
  '  gap: 14px; padding: 24px; min-height: 320px; text-align: center; font-size: 14px;',
  '}',
  '.imqb-title { margin: 0; font-size: 16px; font-weight: 600; }',
  '.imqb-hint { margin: 0; opacity: 0.75; line-height: 1.6; }',
  '.imqb-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }',
  '.imqb-icon { font-size: 32px; line-height: 1; }',
  '.imqb-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }',
  '.imqb-btn, .imqb-pill {',
  '  font: inherit; cursor: pointer; color: inherit;',
  '  transition: background-color .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease;',
  '}',
  '.imqb-btn:disabled, .imqb-pill:disabled { opacity: 0.5; cursor: default; }',
  '.imqb-btn {',
  '  padding: 7px 18px; border-radius: 8px; font-size: 13px;',
  '  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));',
  '  background: transparent;',
  '}',
  '.imqb-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }',
  '.imqb-btn--primary {',
  '  border-color: transparent;',
  '  background: var(--dsw-alias-brand, #4d6bfe); color: #fff; font-weight: 500;',
  '}',
  '.imqb-btn--primary:hover:not(:disabled) { background: var(--dsw-alias-brand-strong, #3b5cf0); }',
  '.imqb-btn--danger { color: var(--dsw-alias-danger, #f26d6d); border-color: var(--dsw-alias-danger, rgba(242, 109, 109, 0.5)); }',
  '.imqb-btn--danger:hover:not(:disabled) { background: var(--dsw-alias-danger, rgba(242, 109, 109, 0.12)); }',
  '.imqb-ghost {',
  '  border: none; background: transparent; opacity: 0.65; padding: 4px 8px;',
  '  font: inherit; font-size: 13px; cursor: pointer; color: inherit;',
  '}',
  '.imqb-ghost:hover { opacity: 1; text-decoration: underline; }',
  '.imqb-ghost:disabled { opacity: 0.4; cursor: default; text-decoration: none; }',
  '/* 插件详情「设置」按钮：30px，略高于旁边的 sm 次要按钮 */',
  '.imqb-pluginOpen {',
  '  display: inline-flex; align-items: center; justify-content: center;',
  '  box-sizing: border-box; height: 30px; padding: 0 14px;',
  '  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));',
  '  border-radius: 8px; background: var(--dsw-alias-bg-layer-1, transparent);',
  '  color: var(--dsw-alias-label-primary, inherit); font: inherit;',
  '  font-size: 13px; line-height: 20px; cursor: pointer;',
  '}',
  '.imqb-pluginOpen:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }',
  '.imqb-pluginOpen:focus-visible { outline: 2px solid var(--dsw-alias-brand, #4d6bfe); outline-offset: 3px; }',
  '@media (pointer: coarse) { .imqb-pluginOpen { height: 44px; } }',
  '/* 主面板页面容器（layout.selectPanel 目标）：滚动 + 留白 */',
  '.imqb-pluginPage {',
  '  height: 100%; min-height: 0; overflow: auto; box-sizing: border-box;',
  '  padding: 24px clamp(16px, 4vw, 48px) 32px;',
  '  color: var(--dsw-alias-label-primary, #1f2329);',
  '}',
  '.imqb-pluginPageContent { max-width: 1080px; margin: 0 auto; }',
  '.imqb-pill {',
  '  padding: 5px 16px; border-radius: 999px; font-size: 13px;',
  '  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4)); background: transparent;',
  '}',
  '.imqb-pill:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }',
  '.imqb-btn:focus-visible, .imqb-pill:focus-visible, .imqb-input:focus-visible, .imqb-ghost:focus-visible {',
  '  outline: 2px solid var(--dsw-alias-brand, #4d6bfe); outline-offset: 1px;',
  '}',
  '.imqb-form { display: flex; flex-direction: column; gap: 12px; width: min(320px, 100%); box-sizing: border-box; }',
  '.imqb-field { display: flex; flex-direction: column; gap: 5px; text-align: left; font-size: 13px; }',
  '.imqb-input {',
  '  padding: 8px 10px; border-radius: 8px; box-sizing: border-box; width: 100%;',
  '  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));',
  '  background: var(--dsw-alias-bg-input, rgba(128, 128, 128, 0.08));',
  '  color: inherit; font: inherit; font-size: 13px; outline: none;',
  '}',
  '.imqb-input:focus { border-color: var(--dsw-alias-brand, #4d6bfe); }',
  '.imqb-error { margin: 0; font-size: 12px; color: var(--dsw-alias-danger, #f26d6d); }',
  '/* 紧凑状态视图（已绑定 / 过渡态）：设置行风格，无居中大卡留白 */',
  '.imqb-status { display: flex; flex-direction: column; text-align: left; font-size: 14px; }',
  '.imqb-status-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; }',
  '.imqb-status-icon { font-size: 24px; line-height: 1; flex: none; }',
  '.imqb-tuicon { flex: none; display: block; border-radius: 8px; }',
  '.imqb-status-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }',
  '.imqb-status-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.5; }',
  '.imqb-status-sub { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, inherit); opacity: .85; }',
  '.imqb-status-actions { display: flex; align-items: center; gap: 8px; padding: 4px 0 12px; }',
  '/* 只读提示（环境变量凭据） */',
  '.imqb-note {',
  '  margin: 0; padding: 8px 10px; border-radius: 8px; text-align: left; font-size: 12px; line-height: 1.6;',
  '  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.1));',
  '  color: var(--dsw-alias-label-secondary, inherit);',
  '}',
  '.imqb-note code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }',
];

/**
 * 注入面板样式（全局一次，幂等）。交互态（hover/active/focus）无法用 inline
 * style 表达，统一收敛到类；DSW 主题变量缺失时用中性值兜底。
 * 插件激活时即安装：插件详情按钮渲染在面板之外，需提前可见；
 * 安装后不再随挂载移除，避免多个展示位互相清掉样式。
 */
export function installPanelStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = PANEL_CSS.join('\n');
  document.head.appendChild(style);
}

function usePanelStyles(): void {
  useEffect(() => { installPanelStyles(); }, []);
}

/**
 * 绑定状态轮询 hook。
 *
 * 404 语义分两种：从未拿到过路由 = 插件未启用（终态）；
 * 曾经拿到过 = HMR 重载窗口期（保存/解绑后路由短暂消失），
 * 低频等待恢复而不是判定终态——否则保存成功提示会被
 * 「插件未启用」覆盖且无法自愈。
 *
 * bound 为稳定态：轮询大幅降频（30s）。因此解绑等本地动作后必须
 * 调用 recheck() 立即重置节拍——否则视图最长停留 30s+ 才收敛到新相位。
 *
 * @returns 轮询快照与 recheck：state 为宿主相位（null = 加载中），
 *          gone 表示插件未启用（从未注册过路由），recheck 废弃当前
 *          定时器并立即重新轮询（新轮询链取代旧链，不产生双计时器）。
 */
export function useBindState(enabled = true): { state: BindStateWire | null; gone: boolean; recheck: () => void } {
  const [state, setState] = useState<BindStateWire | null>(null);
  const [gone, setGone] = useState(false);
  const recheckRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let sawRoute = false;
    let generation = 0;
    let running = false;
    let restartAfterFlight = false;
    // recheck 后的快速收敛窗口：解绑等动作改变的是服务端状态（经
    // HMR 异步生效），动作后立即轮询拿到的可能仍是旧 fiber 的相位
    // （如 bound→30s 降频），窗口期内强制快轮询直到相位真正变化
    let urgentUntil = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (ms: number): void => {
      timer = setTimeout(() => { void tick(); }, ms);
    };

    const intervalFor = (phase: BindStateWire['phase']): number => {
      const base = phase === 'validating'
        ? VALIDATING_POLL_MS
        : phase === 'bound'
          ? BOUND_POLL_MS
          : ACTIVE_POLL_MS;
      return Date.now() < urgentUntil ? Math.min(base, ACTIVE_POLL_MS) : base;
    };

    const tick = async (): Promise<void> => {
      if (stopped || running) return;
      running = true;
      const myGeneration = generation;
      const alive = (): boolean => myGeneration === generation && !stopped;
      try {
        const res = await fetch(BIND_STATE_PATH, { cache: 'no-store' });
        if (res.status === 404) {
          if (!stopped && !sawRoute) setGone(true);
          // sawRoute：HMR 窗口期，保留当前视图等待路由恢复
          else if (alive()) schedule(Date.now() < urgentUntil ? 1000 : 3000);
          return;
        }
        if (!res.ok) {
          if (alive()) schedule(RETRY_POLL_MS);
          return;
        }
        sawRoute = true;
        const body = (await res.json()) as BindStateWire;
        if (!alive()) return;
        setState(body);
        schedule(intervalFor(body.phase));
        return;
      } catch {
        // 宿主启动窗口期不可达：退避重试
      } finally {
        running = false;
        // 在飞期间被 recheck 取代：接力启动新轮询链（否则链会断）
        if (restartAfterFlight && !stopped) {
          restartAfterFlight = false;
          void tick();
        }
      }
      if (alive()) schedule(RETRY_POLL_MS);
    };

    // 立即重置节拍：废弃当前计时器，旧轮询链（在飞请求）作废，
    // 新链立即发起，并进入快速收敛窗口
    recheckRef.current = (): void => {
      generation += 1;
      urgentUntil = Date.now() + 15000;
      if (timer !== undefined) clearTimeout(timer);
      if (running) {
        restartAfterFlight = true;
        return;
      }
      void tick();
    };

    void tick();
    return () => { stopped = true; if (timer !== undefined) clearTimeout(timer); };
  }, []);

  const recheck = useCallback((): void => { recheckRef.current(); }, []);

  return { state, gone, recheck };
}

interface VerifyResult { ok: boolean; message?: string; error?: string; bot?: { name: string; uid: string; account: string } }
interface ManualResult { ok: boolean; message?: string; error?: string }

/** 仅校验凭据（不落盘）：绑定页的「校验」按钮，用来先确认 appId/appSecret 正确 */
async function verifyCredentials(appId: string, appSecret: string): Promise<VerifyResult> {
  try {
    const res = await fetch(BIND_VERIFY_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId, appSecret }),
    });
    const body = (await res.json().catch(() => ({}))) as VerifyResult;
    if (res.ok && body.ok) return { ok: true, message: body.message, bot: body.bot };
    return { ok: false, error: body.error ?? '校验失败（HTTP ' + res.status + '）' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 提交凭据（校验 + 落盘，填写 / 更换共用） */
async function submitManualCredentials(appId: string, appSecret: string): Promise<ManualResult> {
  try {
    const res = await fetch(BIND_MANUAL_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId, appSecret }),
    });
    const body = (await res.json().catch(() => ({}))) as ManualResult;
    if (res.ok && body.ok) return { ok: true, message: body.message };
    return { ok: false, error: body.error ?? '保存失败（HTTP ' + res.status + '）' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 手动凭据表单（填写 / 更换共用）。
 *
 * appSecret 永不回显（占位符提示）；「校验」只读调用 property.info 并把
 * 机器人名称/账号显示出来，「保存」才写入 profile patch 并触发 HMR 重载。
 */
function ManualForm({ initialAppId }: { initialAppId?: string }): ReactNode {
  const [appId, setAppId] = useState(initialAppId ?? '');
  const [appSecret, setAppSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyResult | null>(null);
  const [result, setResult] = useState<ManualResult | null>(null);

  const filled = appId.trim().length > 0 && appSecret.trim().length > 0;

  const check = useCallback((): void => {
    if (busy || verifying) return;
    if (!filled) {
      setVerifyState({ ok: false, error: 'appId 与 appSecret 均为必填' });
      return;
    }
    setVerifying(true);
    void verifyCredentials(appId.trim(), appSecret.trim()).then((outcome) => {
      setVerifyState(outcome);
      setVerifying(false);
      setResult(null);
    });
  }, [appId, appSecret, busy, filled, verifying]);

  const submit = useCallback((event: FormEvent): void => {
    event.preventDefault();
    if (busy || verifying) return;
    const trimmedId = appId.trim();
    const trimmedSecret = appSecret.trim();
    if (trimmedId.length === 0 || trimmedSecret.length === 0) {
      setResult({ ok: false, error: 'appId 与 appSecret 均为必填' });
      return;
    }
    setBusy(true);
    void submitManualCredentials(trimmedId, trimmedSecret).then((outcome) => {
      setResult(outcome);
      setBusy(false);
    });
  }, [appId, appSecret, busy, verifying]);

  if (result !== null && result.ok) {
    return createElement('div', { className: 'imqb-status' },
      createElement('div', { className: 'imqb-status-row' },
        createElement('div', { className: 'imqb-status-icon' }, '✅'),
        createElement('div', { className: 'imqb-status-meta' },
          createElement('p', { className: 'imqb-status-title' }, result.message ?? '凭据已保存'),
          createElement('p', { className: 'imqb-status-sub' }, '插件将自动重载；稍后即可开始对话'),
        ),
      ),
    );
  }

  return createElement('form', { className: 'imqb-form', onSubmit: submit },
    createElement('label', { className: 'imqb-field' },
      'AppID',
      createElement('input', {
        className: 'imqb-input', value: appId, placeholder: '推推机器人 AppID',
        onChange: (event) => { setAppId(event.currentTarget.value); },
        autoComplete: 'off', spellCheck: false,
      }),
    ),
    createElement('label', { className: 'imqb-field' },
      'AppSecret',
      createElement('input', {
        className: 'imqb-input', type: 'password', value: appSecret,
        placeholder: initialAppId === undefined ? '推推机器人 AppSecret' : '输入新的 AppSecret（不回显）',
        onChange: (event) => { setAppSecret(event.currentTarget.value); },
        autoComplete: 'new-password',
      }),
    ),
    verifyState !== null && verifyState.ok
      ? createElement('p', { className: 'imqb-status-sub' },
          '✔ ' + (verifyState.message ?? '校验通过') + '（尚未保存）')
      : null,
    verifyState !== null && !verifyState.ok
      ? createElement('p', { className: 'imqb-error' }, verifyState.error)
      : null,
    result !== null && !result.ok
      ? createElement('p', { className: 'imqb-error' }, result.error)
      : null,
    createElement('div', { className: 'imqb-row' },
      createElement('button', {
        className: 'imqb-pill', type: 'button',
        onClick: check, disabled: busy || verifying || !filled,
      }, verifying ? '正在校验…' : '校验'),
      createElement('button', { className: 'imqb-btn imqb-btn--primary', type: 'submit', disabled: busy || verifying },
        busy ? '正在保存…' : '保存'),
    ),
  );
}

/**
 * 推推机器人图标（矢量路径，内嵌以保持 bundle 自包含）。
 *
 * 用「对话气泡」表达 IM 机器人身份：推推没有对外统一的品牌图形资源，
 * 自绘矢量在明暗主题下都能跟随 currentColor。
 */
export const TUITUI_LOGO_PATH =
  'M12 3.2c-4.97 0-9 3.4-9 7.6 0 2.32 1.24 4.4 3.2 5.83v3.42a.6.6 0 0 0 .92.5l3.5-2.1c.45.06.91.09 1.38.09 4.97 0 9-3.4 9-7.6s-4.03-7.6-9-7.6Z';

/** 推推机器人图标（透明底，随 size 缩放） */
function TuituiIcon({ size = 28 }: { size?: number }): ReactNode {
  return createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    'aria-hidden': true, className: 'imqb-tuicon',
  },
    createElement('path', { d: TUITUI_LOGO_PATH, fill: '#1F6FEB' }),
    createElement('circle', { cx: 8.4, cy: 10.8, r: 1.15, fill: '#fff' }),
    createElement('circle', { cx: 12, cy: 10.8, r: 1.15, fill: '#fff' }),
    createElement('circle', { cx: 15.6, cy: 10.8, r: 1.15, fill: '#fff' }),
  );
}

/** 已绑定视图：回显机器人名称/账号 + 更换凭据 / 解绑入口 */
function BoundView({ appId, botName, botAccount, fromEnv, recheck }: {
  appId: string;
  botName?: string;
  botAccount?: string;
  fromEnv: boolean;
  recheck: () => void;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const [unbindResult, setUnbindResult] = useState<{ ok: boolean; message: string } | null>(null);

  const unbind = useCallback((): void => {
    if (!window.confirm('确定解绑吗？\n解绑后机器人立即下线，插件将重新进入绑定流程。')) return;
    void fetch(BIND_UNBIND_PATH, { method: 'POST' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
        if (res.ok && body.ok === true) {
          setUnbindResult({ ok: true, message: body.message ?? '已解绑，插件将重载并重新进入绑定流程' });
          // bound 态轮询已降频到 30s：立即重置节拍，让 unconfigured
          // 尽快出现而不是等下一个 30s 周期
          recheck();
          return;
        }
        setUnbindResult({ ok: false, message: body.error ?? '解绑失败（HTTP ' + res.status + '）' });
      })
      .catch((err: unknown) => {
        setUnbindResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
      });
  }, [recheck]);

  if (unbindResult !== null) {
    // 非终态视图：解绑成功后正常由轮询收敛到 unconfigured；若 HMR 未
    // 触发（状态停留 bound），用户仍有「刷新状态」出口而不是死胡同
    return createElement('div', { className: 'imqb-status' },
      createElement('div', { className: 'imqb-status-row' },
        createElement('div', { className: 'imqb-status-icon' }, unbindResult.ok ? '👋' : '⚠️'),
        createElement('div', { className: 'imqb-status-meta' },
          createElement('p', { className: 'imqb-status-title' }, unbindResult.message),
        ),
        unbindResult.ok
          ? createElement('button', { className: 'imqb-ghost', onClick: recheck }, '刷新状态')
          : createElement('button', { className: 'imqb-ghost', onClick: () => { setUnbindResult(null); } }, '返回'),
      ),
    );
  }

  if (editing) {
    return createElement('div', { className: 'imqb-status' },
      createElement('div', { className: 'imqb-status-row' },
        createElement('div', { className: 'imqb-status-meta' },
          createElement('p', { className: 'imqb-status-title' }, '更换凭据'),
        ),
        createElement('button', { className: 'imqb-ghost', onClick: () => { setEditing(false); } }, '返回'),
      ),
      createElement(ManualForm, { initialAppId: appId }),
    );
  }

  const who = botName !== undefined
    ? botName + (botAccount !== undefined ? '（账号 ' + botAccount + '）' : '')
    : undefined;

  return createElement('div', { className: 'imqb-status' },
    createElement('div', { className: 'imqb-status-row' },
      createElement(TuituiIcon, { size: 28 }),
      createElement('div', { className: 'imqb-status-meta' },
        createElement('p', { className: 'imqb-status-title' }, who === undefined ? '已绑定' : '已绑定 ' + who),
        createElement('p', { className: 'imqb-status-sub imqb-mono' }, 'AppID ' + appId + ' · 单聊 / 群聊 / 团队频道已接入'),
      ),
    ),
    fromEnv
      ? createElement('p', { className: 'imqb-note' },
          '凭据来自环境变量 ',
          createElement('code', null, 'TUITUI_BOT_APPID'),
          ' / ',
          createElement('code', null, 'TUITUI_BOT_SECRET'),
          '，端内不可解绑；请修改部署环境后重启。',
        )
      : null,
    createElement('div', { className: 'imqb-status-actions' },
      createElement('button', {
        className: 'imqb-btn imqb-btn--primary', onClick: () => { setEditing(true); }, disabled: fromEnv,
      }, '更换凭据'),
      createElement('button', {
        className: 'imqb-btn imqb-btn--danger', onClick: unbind, disabled: fromEnv,
      }, '解绑'),
    ),
  );
}

/** 未绑定视图：手填凭据（推推无扫码，只有这一条路径） */
function UnboundView(): ReactNode {
  return createElement('div', { className: 'imqb-panel' },
    createElement(TuituiIcon, { size: 40 }),
    createElement('p', { className: 'imqb-title' }, '绑定推推机器人'),
    createElement('p', { className: 'imqb-hint' },
      '在推推机器人管理后台创建自建机器人，取得 AppID 与 AppSecret 后填在这里。',
    ),
    createElement(ManualForm, {}),
    createElement('p', { className: 'imqb-hint imqb-mono' },
      '也可以改用环境变量 TUITUI_BOT_APPID / TUITUI_BOT_SECRET',
    ),
  );
}

/** 依据宿主相位渲染面板主体（可注入共享轮询结果避免双计时器） */
export function BindPanelBody(props: {
  state?: BindStateWire | null;
  gone?: boolean;
  recheck?: () => void;
} = {}): ReactNode {
  usePanelStyles();
  // 共享轮询：设置页把同一份 state 注入两个展示位，避免各起一条轮询链
  const injectedState = props.state;
  const internal = useBindState(injectedState === undefined);
  const state: BindStateWire | null = injectedState !== undefined ? injectedState : internal.state;
  const gone = injectedState !== undefined ? (props.gone ?? false) : internal.gone;
  const recheck = injectedState !== undefined ? (props.recheck ?? (() => {})) : internal.recheck;

  if (gone) {
    return createElement('div', { className: 'imqb-panel' },
      createElement('div', { className: 'imqb-icon' }, '❔'),
      createElement('p', { className: 'imqb-hint' }, '插件未启用，或当前版本不支持端内配置'),
    );
  }

  if (state === null) {
    return createElement('div', { className: 'imqb-panel' },
      createElement('p', { className: 'imqb-hint' }, '正在获取绑定状态…'),
    );
  }

  if (state.phase === 'bound') {
    return createElement(BoundView, {
      appId: state.appId,
      botName: state.botName,
      botAccount: state.botAccount,
      fromEnv: state.fromEnv === true,
      recheck,
    });
  }

  if (state.phase === 'validating') {
    return createElement('div', { className: 'imqb-panel' },
      createElement('div', { className: 'imqb-icon' }, '⏳'),
      createElement('p', { className: 'imqb-hint' }, '正在校验凭据…'),
    );
  }

  if (state.phase === 'failed') {
    return createElement('div', { className: 'imqb-panel' },
      createElement('div', { className: 'imqb-icon' }, '⚠️'),
      createElement('p', { className: 'imqb-title' }, '绑定失败'),
      createElement('p', { className: 'imqb-hint' }, state.reason),
      createElement(ManualForm, {}),
    );
  }

  return createElement(UnboundView);
}

/**
 * 版本条 —— 已绑定状态行右侧的一小簇「仓库 / 版本 / 更新」
 *
 * 为什么放在状态行而不是配置底部：
 *   · 它跟「我是谁、装的是哪一版」是同一类信息，天然靠在一起；
 *   · 配置区是「保存后重载」的表单，而版本/更新是即时动作，混进去会让人以为要保存。
 *
 * 状态收敛成六种，任何网络或版本差异都不能让它看起来像坏了：
 *   loading → idle（检查更新） / checking → latest | update | ahead | failed | unavailable
 * 其中 unavailable 专门对付「客户端已经热更、服务端还没重载」——那种 404 不是错误，
 * 页面必须说人话，而不是甩一个 HTTP 404。
 */
import { createElement, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ABOUT_PATH,
  REPO_URL,
  UPDATE_APPLY_PATH,
  UPDATE_CHECK_PATH,
  UPDATE_REQUEST_HEADER,
  type AboutWire,
  type UpdateApplyWire,
  type UpdateStatusWire,
} from '../shared/about-protocol.ts';

/** GitHub 徽标（官方 mark，16×16）：内联 SVG，不引外链 */
const GITHUB_MARK_PATH = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z';

const STYLE_ID = 'imqb-about-styles';

const ABOUT_CSS: readonly string[] = [
  '.imqb-about { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }',
  '.imqb-about-repo { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 7px; color: var(--dsw-alias-label-tertiary); transition: background .15s, color .15s; }',
  '.imqb-about-repo:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-secondary, rgba(127,127,127,.12)); }',
  '.imqb-about-repo svg { width: 15px; height: 15px; fill: currentColor; }',
  '.imqb-about-ver { font-size: 12px; line-height: 1; padding: 4px 7px; border-radius: 6px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-secondary, rgba(127,127,127,.12)); }',
  '.imqb-about-chip { font-size: 11px; line-height: 1; padding: 4px 7px; border-radius: 999px; border: 1px solid currentColor; opacity: .9; white-space: nowrap; }',
  '.imqb-about-chip--new { color: var(--dsw-alias-brand-primary, #3b82f6); }',
  '.imqb-about-chip--muted { color: var(--dsw-alias-label-tertiary); }',
  '.imqb-about-chip--warn { color: var(--dsw-alias-warning-primary, #d97706); }',
  '.imqb-about-btn { appearance: none; font: inherit; font-size: 12px; line-height: 1; padding: 5px 10px; border-radius: 7px; cursor: pointer; white-space: nowrap; border: 1px solid var(--dsw-alias-line-normal, rgba(127,127,127,.35)); background: transparent; color: var(--dsw-alias-label-secondary); transition: background .15s, color .15s, border-color .15s; }',
  '.imqb-about-btn:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-secondary, rgba(127,127,127,.12)); }',
  '.imqb-about-btn:disabled { opacity: .55; cursor: default; }',
  '.imqb-about-btn--primary { border-color: transparent; background: var(--dsw-alias-brand-primary, #3b82f6); color: #fff; }',
  '.imqb-about-btn--primary:hover:not(:disabled) { filter: brightness(1.08); color: #fff; background: var(--dsw-alias-brand-primary, #3b82f6); }',
  '.imqb-about-note { font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-tertiary); max-width: 320px; }',
];

/** 注入样式（幂等） */
export function installAboutStyles(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (doc === undefined) return;
  if (doc.getElementById(STYLE_ID) !== null) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = ABOUT_CSS.join('\n');
  doc.head.appendChild(style);
}

type Phase = 'loading' | 'idle' | 'checking' | 'applying' | 'latest' | 'update' | 'ahead' | 'failed' | 'unavailable';

/** 版本条本体 */
export function AboutBar(): ReactNode {
  installAboutStyles();
  const [about, setAbout] = useState<AboutWire | null>(null);
  const [status, setStatus] = useState<UpdateStatusWire | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [note, setNote] = useState<string | null>(null);

  const loadAbout = useCallback((): void => {
    void fetch(ABOUT_PATH, { cache: 'no-store' })
      .then(async (res) => {
        // 404 = 客户端已热更、服务端还没重载：不是故障，只是等待重启
        if (res.status === 404) {
          setPhase('unavailable');
          setNote('重启 dsh 后这里会显示版本与更新');
          return;
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const body = (await res.json()) as AboutWire;
        setAbout(body);
        setPhase((current) => (current === 'unavailable' ? 'idle' : current));
      })
      .catch((err: unknown) => {
        setPhase('unavailable');
        setNote('读取版本信息失败：' + (err instanceof Error ? err.message : String(err)));
      });
  }, []);

  const check = useCallback((refresh: boolean): void => {
    setPhase('checking');
    setNote(null);
    void fetch(refresh ? UPDATE_CHECK_PATH + '?refresh=1' : UPDATE_CHECK_PATH, { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 404) {
          setPhase('unavailable');
          setNote('重启 dsh 后这里会显示版本与更新');
          return;
        }
        const body = (await res.json().catch(() => null)) as UpdateStatusWire | null;
        if (body === null) throw new Error('HTTP ' + res.status);
        setStatus(body);
        if (!body.ok) {
          setPhase('failed');
          setNote(body.error ?? '检查失败');
          return;
        }
        setPhase(body.hasUpdate ? 'update' : body.ahead ? 'ahead' : 'latest');
      })
      .catch((err: unknown) => {
        setPhase('failed');
        setNote('检查失败：' + (err instanceof Error ? err.message : String(err)));
      });
  }, []);

  const apply = useCallback((): void => {
    setPhase('applying');
    setNote(null);
    void fetch(UPDATE_APPLY_PATH, { method: 'POST', headers: { [UPDATE_REQUEST_HEADER]: '1' } })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as UpdateApplyWire | null;
        if (body === null) throw new Error('HTTP ' + res.status);
        if (!body.ok) {
          setPhase('failed');
          setNote(body.error ?? '更新失败');
          return;
        }
        if (body.to === null || body.to === body.from) {
          setPhase('latest');
          setNote(body.detail ?? '已是最新版本');
          return;
        }
        setPhase('latest');
        setNote(body.hotReload
          ? '已更新到 v' + body.to + '，正在热重载（不用重启）'
          : '已更新到 v' + body.to + '，重启 dsh 后生效');
        if (body.hotReload) {
          // 热重载会重载本插件：给它起来的时间再读一次版本
          setTimeout(() => {
            void fetch(ABOUT_PATH, { cache: 'no-store' })
              .then(async (res) => {
                if (!res.ok) return;
                setAbout((await res.json()) as AboutWire);
                setStatus(null);
              })
              .catch(() => { /* 重载窗口里读不到属正常 */ });
          }, 4000);
        }
      })
      .catch((err: unknown) => {
        setPhase('failed');
        setNote('更新失败：' + (err instanceof Error ? err.message : String(err)));
      });
  }, []);

  // 挂载即读版本；读到之后顺带做一次走缓存的检查（6h 内不重复打 GitHub）
  useEffect(() => {
    loadAbout();
  }, [loadAbout]);

  useEffect(() => {
    if (about === null) return;
    if (!about.selfUpdate.enabled) {
      setPhase('idle');
      return;
    }
    check(false);
  }, [about, check]);

  const version = about?.version ?? '…';
  const repoUrl = about?.repoUrl ?? REPO_URL;
  const repoLabel = about?.repoSlug ?? 'EayonLee/dsh-tuitui-bot';
  const latest = status?.latest ?? null;
  const busy = phase === 'checking' || phase === 'applying';

  return createElement('div', { className: 'imqb-about' },
    createElement('a', {
      className: 'imqb-about-repo',
      href: repoUrl,
      target: '_blank',
      rel: 'noopener noreferrer',
      title: '在 GitHub 打开 ' + repoLabel,
      'aria-label': '在 GitHub 打开仓库',
    }, createElement('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
      createElement('path', { d: GITHUB_MARK_PATH }))),

    createElement('span', { className: 'imqb-about-ver', title: '当前安装版本' }, 'v' + version),

    phase === 'unavailable'
      ? createElement('span', { className: 'imqb-about-chip imqb-about-chip--muted', title: note ?? undefined }, '待重启')
      : null,

    phase === 'update' && latest !== null
      ? createElement('button', {
          className: 'imqb-about-btn imqb-about-btn--primary',
          onClick: apply,
          disabled: busy,
          title: '下载并安装 v' + latest + '（装完自动热重载）',
        }, '更新到 v' + latest)
      : null,

    phase === 'update' && latest !== null
      ? null
      : createElement('button', {
          className: 'imqb-about-btn',
          onClick: () => { check(true); },
          disabled: busy || phase === 'unavailable',
          title: '检查线上最新版本',
        }, phase === 'checking' ? '检查中…' : phase === 'applying' ? '更新中…' : '检查更新'),

    phase === 'latest'
      ? createElement('span', { className: 'imqb-about-chip imqb-about-chip--muted' }, '已是最新')
      : null,
    phase === 'ahead'
      ? createElement('span', { className: 'imqb-about-chip imqb-about-chip--muted', title: '本地版本比线上高：自己改过、还没发布' }, '本地更新')
      : null,
    phase === 'failed'
      ? createElement('span', { className: 'imqb-about-chip imqb-about-chip--warn', title: note ?? undefined }, '检查失败')
      : null,
    note !== null && (phase === 'latest' || phase === 'update' || phase === 'applying')
      ? createElement('span', { className: 'imqb-about-note' }, note)
      : null,
    note !== null && phase === 'failed'
      ? createElement('span', { className: 'imqb-about-note' }, note)
      : null,
  );
}

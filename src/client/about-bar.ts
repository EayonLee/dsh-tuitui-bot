/**
 * 版本条 —— 已绑定状态行右侧的一小簇「仓库 / 版本 / 更新」
 *
 * 为什么放在状态行而不是配置底部：
 *   · 它跟「我是谁、装的是哪一版」是同一类信息，天然靠在一起；
 *   · 配置区是「保存后重载」的表单，而版本/更新是即时动作，混进去会让人以为要保存。
 *
 * 展示逻辑全在 shared/about-view.ts（纯函数、可单测），这里只负责画和发请求：
 *   · 版本号永不省略，读不到就整块不显示；
 *   · 「检查更新」只在进行中禁用，已是最新时点下去会明确回执；
 *   · 每种状态都有颜色（待重启/检查失败=橙，已是最新=绿，本地更新=蓝）。
 */
import { createElement, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ABOUT_PATH,
  UPDATE_APPLY_PATH,
  UPDATE_CHECK_PATH,
  UPDATE_REQUEST_HEADER,
  type AboutWire,
  type UpdateApplyWire,
  type UpdateStatusWire,
} from '../shared/about-protocol.ts';
import { deriveAboutView, manualCheckNote, type AboutPhase } from '../shared/about-view.ts';

/** GitHub 徽标（官方 mark，16×16）：内联 SVG，不引外链 */
const GITHUB_MARK_PATH = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z';

const STYLE_ID = 'imqb-about-styles';

const ABOUT_CSS: readonly string[] = [
  '.imqb-about { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; font-size: 12px; }',
  // 仓库图标
  '.imqb-about-repo { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 7px; color: var(--dsw-alias-label-secondary); transition: background .15s, color .15s; }',
  '.imqb-about-repo:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-secondary, rgba(127,127,127,.14)); }',
  '.imqb-about-repo svg { width: 15px; height: 15px; fill: currentColor; }',
  // 版本号：不截断、不省略
  '.imqb-about-ver { font-size: 12px; line-height: 1; padding: 4px 7px; border-radius: 6px; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-secondary, rgba(127,127,127,.14)); }',
  // 状态标签：四档色调，全部有底色，不允许灰字小透明
  '.imqb-about-chip { font-size: 11px; line-height: 1; padding: 4px 8px; border-radius: 999px; white-space: nowrap; border: 1px solid transparent; font-weight: 500; }',
  '.imqb-about-chip--muted { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-secondary, rgba(127,127,127,.14)); }',
  '.imqb-about-chip--info { color: #1d4ed8; background: rgba(59,130,246,.14); border-color: rgba(59,130,246,.35); }',
  '.imqb-about-chip--warn { color: #b45309; background: rgba(245,158,11,.16); border-color: rgba(245,158,11,.45); }',
  '.imqb-about-chip--ok { color: #15803d; background: rgba(34,197,94,.16); border-color: rgba(34,197,94,.4); }',
  '.imqb-about-chip--muted.imqb-about-chip--warn { animation: none; }',
  '@media (prefers-color-scheme: dark) {',
  '  .imqb-about-chip--info { color: #93c5fd; background: rgba(59,130,246,.22); }',
  '  .imqb-about-chip--warn { color: #fbbf24; background: rgba(245,158,11,.2); }',
  '  .imqb-about-chip--ok { color: #4ade80; background: rgba(34,197,94,.22); }',
  '}',
  // 按钮
  '.imqb-about-btn { appearance: none; font: inherit; font-size: 12px; line-height: 1; padding: 5px 10px; border-radius: 7px; cursor: pointer; white-space: nowrap; border: 1px solid var(--dsw-alias-line-normal, rgba(127,127,127,.4)); background: transparent; color: var(--dsw-alias-label-secondary); transition: background .15s, color .15s, border-color .15s, filter .15s; }',
  '.imqb-about-btn:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-secondary, rgba(127,127,127,.14)); }',
  '.imqb-about-btn:disabled { opacity: .6; cursor: default; }',
  '.imqb-about-btn--primary { border-color: transparent; background: var(--dsw-alias-brand-primary, #3b82f6); color: #fff; font-weight: 500; }',
  '.imqb-about-btn--primary:hover:not(:disabled) { filter: brightness(1.09); color: #fff; background: var(--dsw-alias-brand-primary, #3b82f6); }',
  // 回执文案
  '.imqb-about-note { font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-secondary); max-width: 340px; }',
  '.imqb-about-note--warn { color: #b45309; }',
  '@media (prefers-color-scheme: dark) { .imqb-about-note--warn { color: #fbbf24; } }',
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

/** 版本条本体 */
export function AboutBar(): ReactNode {
  installAboutStyles();
  const [about, setAbout] = useState<AboutWire | null>(null);
  const [status, setStatus] = useState<UpdateStatusWire | null>(null);
  const [phase, setPhase] = useState<AboutPhase>('loading');
  const [note, setNote] = useState<string | null>(null);

  const loadAbout = useCallback((): void => {
    void fetch(ABOUT_PATH, { cache: 'no-store' })
      .then(async (res) => {
        // 404 = 客户端已热更、服务端还没重载：不是故障，只是等待重启
        if (res.status === 404) {
          setPhase('unavailable');
          setNote('服务端还是旧代码，重启 dsh 后这里会显示版本与更新');
          return;
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const body = (await res.json()) as AboutWire;
        setAbout(body);
        setPhase((current) => (current === 'unavailable' ? 'idle' : current));
        setNote((current) => (current === null ? current : null));
      })
      .catch((err: unknown) => {
        setPhase('unavailable');
        setNote('读取版本信息失败：' + (err instanceof Error ? err.message : String(err)));
      });
  }, []);

  const check = useCallback((refresh: boolean, manual: boolean): void => {
    setPhase('checking');
    if (manual) setNote(null);
    void fetch(refresh ? UPDATE_CHECK_PATH + '?refresh=1' : UPDATE_CHECK_PATH, { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 404) {
          setPhase('unavailable');
          setNote('服务端还是旧代码，重启 dsh 后这里会显示版本与更新');
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
        // 手动点才有回执：自动检查每次进页面都跳一句「已是最新」太吵
        if (manual) setNote(manualCheckNote(body));
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
      setPhase((current) => (current === 'loading' ? 'idle' : current));
      return;
    }
    check(false, false);
  }, [about, check]);

  const view = deriveAboutView({ about, status, phase, note });
  const showNote = view.note !== null && phase !== 'loading';

  return createElement('div', { className: 'imqb-about' },
    createElement('a', {
      className: 'imqb-about-repo',
      href: view.repoUrl,
      target: '_blank',
      rel: 'noopener noreferrer',
      title: view.repoTitle,
      'aria-label': view.repoTitle,
    }, createElement('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
      createElement('path', { d: GITHUB_MARK_PATH }))),

    // 读不到版本就整块不出现 —— 绝不用「…」占位
    view.versionLabel === null
      ? null
      : createElement('span', { className: 'imqb-about-ver', title: view.versionTitle ?? undefined }, view.versionLabel),

    view.chip === null
      ? null
      : createElement('span', {
          className: 'imqb-about-chip imqb-about-chip--' + view.chip.tone,
          title: view.chip.title ?? undefined,
        }, view.chip.label),

    view.apply === null
      ? null
      : createElement('button', {
          className: 'imqb-about-btn imqb-about-btn--primary',
          onClick: apply,
          disabled: !view.apply.enabled,
        }, view.apply.label),

    createElement('button', {
      className: 'imqb-about-btn',
      onClick: () => { check(true, true); },
      disabled: !view.check.enabled,
      title: '检查线上最新版本',
    }, view.check.label),

    showNote
      ? createElement('span', {
          className: 'imqb-about-note' + (phase === 'failed' || phase === 'unavailable' ? ' imqb-about-note--warn' : ''),
        }, view.note)
      : null,
  );
}

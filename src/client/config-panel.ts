/**
 * 推推机器人配置面板 — 必要配置的 UI 编辑
 *
 * 设计要点（按 pro UI/UX 规范重排）：
 *   1. 分区卡片 + 两列字段网格：宽屏 label 左、控件右；窄屏自动落成单列，
 *      不会再出现「label 与输入框各占一行、整体竖着挤」的漂移。
 *   2. 名单类配置用标签（chip）输入：回车/逗号成标签，Backspace 删最后一个，
 *      点 × 删除单个，比一行逗号文本可读得多。
 *   3. 工作区改用下拉选择（服务端回传候选目录），避免手打路径出错。
 *   4. 模型选择不再暴露：沿用宿主默认，减少用户做无意义决策。
 *
 * 数据流：GET /tuitui/im-tuitui/config 回显当前生效配置（appSecret 由宿主剔除）
 * → 表单编辑 → dirty diff → POST 仅提交变更键 → 服务端白名单 + Schema 校验 →
 * 最小写入 profile patch → HMR 重载生效。
 *
 * 键名口径：线上读写都用 dotted key（access.c2cMode 等），与服务端
 * shared/bind-protocol.ts 的 ConfigPatchWire 完全一致。
 */
import { createElement, useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { BIND_CONFIG_PATH } from '../shared/bind-protocol.ts';
import { DEFAULT_SMART_PROMPT } from '../shared/smart-prompt.ts';

/** 访问模式四值（与 src/config.ts 的 AccessControlConfig 一致） */
type AccessMode = 'open' | 'allowlist' | 'blocklist' | 'disabled';

/** 触发方式三档 */
type MentionPolicy = 'require' | 'always' | 'smart';

/** 同一会话忙时的处理方式 */
type ConcurrencyStrategy = 'queue' | 'abort' | 'drop' | 'merge';

/** GET 回显 / POST 提交的扁平配置（appSecret 已剔除） */
interface ConfigWire {
  provider?: string;
  model?: string;
  preset?: string;
  cwd?: string;
  /** 服务端回传的工作区候选目录（只读，不提交） */
  workspaceOptions?: string[];
  requireMention?: boolean;
  requireMentionInPost?: boolean;
  streaming?: boolean;
  showToolResults?: boolean;
  debug?: boolean;
  historyLimit?: number;
  sessionIdleTimeout?: number;
  'access.c2cMode'?: AccessMode;
  'access.groupMode'?: AccessMode;
  'access.postMode'?: AccessMode;
  'access.c2cAllow'?: string[];
  'access.c2cBlock'?: string[];
  'access.groupAllow'?: string[];
  'access.groupBlock'?: string[];
  'access.postAllow'?: string[];
  'access.postBlock'?: string[];
  mentionPolicy?: MentionPolicy;
  'sendFile.restrictPaths'?: boolean;
  'smartJudge.prompt'?: string;
  'smartJudge.maxHistory'?: number;
  'smartJudge.cooldownMs'?: number;
  'smartJudge.timeoutMs'?: number;
  'interactive.enabled'?: boolean;
  'agentSteps.enabled'?: boolean;
  'concurrency.c2c'?: ConcurrencyStrategy;
  'concurrency.group'?: ConcurrencyStrategy;
  'concurrency.post'?: ConcurrencyStrategy;
  'reactions.enabled'?: boolean;
  'reactions.inGroup'?: boolean;
  'reactions.ack'?: string;
  'reactions.done'?: string;
  'reactions.fail'?: string;
}

const MODE_OPTIONS: ReadonlyArray<{ value: AccessMode; label: string }> = [
  { value: 'open', label: '所有人' },
  { value: 'allowlist', label: '白名单' },
  { value: 'blocklist', label: '黑名单' },
  { value: 'disabled', label: '禁用' },
];

const CONCURRENCY_OPTIONS: ReadonlyArray<{ value: ConcurrencyStrategy; label: string }> = [
  { value: 'queue', label: '排队' },
  { value: 'abort', label: '打断' },
  { value: 'merge', label: '合并' },
  { value: 'drop', label: '丢弃' },
];

const POLICY_OPTIONS: ReadonlyArray<{ value: MentionPolicy; label: string }> = [
  { value: 'require', label: '仅 @' },
  { value: 'smart', label: '智能' },
  { value: 'always', label: '全部' },
];

/** 样式注入标记（幂等） */
const STYLE_ID = 'im-tuitui-config-panel-styles';

const PANEL_CSS: readonly string[] = [
  /* ── 容器 ── */
  '.imqb2-form { display: flex; flex-direction: column; width: 100%; padding-bottom: 8px; }',
  '.imqb2-section { padding: 4px 0 10px; }',
  '.imqb2-section + .imqb2-section { margin-top: 4px; }',
  '.imqb2-section-head { display: flex; flex-direction: column; gap: 3px; padding: 18px 0 10px; }',
  '.imqb2-section-title { font-size: 13px; font-weight: 600; line-height: 20px; color: var(--dsw-alias-label-primary); }',
  '.imqb2-section-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); margin: 0; }',

  /* ── 字段行：label | control 两列，窄屏落单列 ── */
  '.imqb2-rows { display: flex; flex-direction: column; }',
  '.imqb2-row {',
  '  display: grid; grid-template-columns: 180px minmax(0, 1fr);',
  '  align-items: start; gap: 4px 16px; padding: 12px 0;',
  '}',
  '.imqb2-row + .imqb2-row { border-top: 0.5px solid var(--dsw-alias-border-l2); }',
  '.imqb2-row-label {',
  '  display: flex; flex-direction: column; gap: 2px; min-width: 0;',
  '  padding-top: 8px; font-size: 13px; font-weight: 500; line-height: 18px;',
  '  color: var(--dsw-alias-label-primary);',
  '}',
  '.imqb2-row-label-sub { font-size: 11px; font-weight: 400; line-height: 16px; color: var(--dsw-alias-label-tertiary); }',
  '.imqb2-row-control { display: flex; flex-direction: column; gap: 6px; min-width: 0; align-items: stretch; }',
  '.imqb2-row-control--inline { flex-direction: row; align-items: center; justify-content: flex-start; }',
  '.imqb2-help { margin: 0; font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-secondary); }',
  '@media (max-width: 620px) {',
  '  .imqb2-row { grid-template-columns: minmax(0, 1fr); gap: 6px; }',
  '  .imqb2-row-label { padding-top: 0; }',
  '}',

  /* ── 作用域卡片：三个范围各自成块，标题带模式下拉 ── */
  '.imqb2-scope {',
  '  box-sizing: border-box; padding: 2px 14px 6px; margin-top: 10px;',
  '  border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 12px;',
  '  background: var(--dsw-alias-bg-layer-2);',
  '}',
  '.imqb2-scope-head { display: flex; align-items: center; gap: 10px; padding: 12px 0 6px; }',
  '.imqb2-scope-title-wrap { display: flex; flex-direction: column; gap: 1px; min-width: 0; }',
  '.imqb2-scope-name { font-size: 13px; font-weight: 600; line-height: 18px; color: var(--dsw-alias-label-primary); }',
  '.imqb2-scope-desc { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }',
  '.imqb2-scope-head .imqb2-select {',
  '  flex: 0 0 auto; width: 112px; max-width: 112px; height: 28px; margin-left: auto; padding: 0 24px 0 9px;',
  '  background-position: calc(100% - 14px) 12px, calc(100% - 9px) 12px;',
  '}',
  '.imqb2-scope .imqb2-row { grid-template-columns: 92px minmax(0, 1fr); gap: 4px 12px; padding: 6px 0; }',
  '.imqb2-scope .imqb2-row + .imqb2-row { border-top: 0; }',
  '.imqb2-scope .imqb2-row-label { padding-top: 7px; font-size: 12px; font-weight: 400; color: var(--dsw-alias-label-secondary); }',
  '.imqb2-scope .imqb2-help { font-size: 11px; line-height: 16px; }',
  '@media (max-width: 620px) {',
  '  .imqb2-scope .imqb2-row { grid-template-columns: minmax(0, 1fr); }',
  '  .imqb2-scope .imqb2-row-label { padding-top: 0; }',
  '}',

  /* ── Switch ── */
  '.imqb2-switch {',
  '  box-sizing: border-box; position: relative; flex: 0 0 auto;',
  '  width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px;',
  '  background: var(--dsw-alias-border-l3); cursor: pointer; font: inherit;',
  '}',
  ".imqb2-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }",
  '.imqb2-switch:disabled { cursor: default; opacity: 0.5; }',
  '.imqb2-switch:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }',
  '.imqb2-switch-thumb {',
  '  display: block; width: 16px; height: 16px; border-radius: 50%;',
  '  background: var(--dsw-alias-switch-thumb, #ffffff); transition: transform 120ms ease;',
  '}',
  ".imqb2-switch[aria-checked='true'] .imqb2-switch-thumb { transform: translateX(16px); }",

  /* ── 输入 / 下拉 ── */
  '.imqb2-input {',
  '  box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px;',
  '  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);',
  '  background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.5;',
  '  color: var(--dsw-alias-label-primary);',
  '}',
  '.imqb2-input:focus { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }',
  '.imqb2-number { display: inline-flex; align-items: center; gap: 6px; }',
  '.imqb2-input--number { width: 96px; text-align: right; font-variant-numeric: tabular-nums; }',
  '.imqb2-number-unit { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }',
  '.imqb2-textarea {',
  '  box-sizing: border-box; width: 100%; min-height: 220px; padding: 10px 12px;',
  '  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);',
  '  background: var(--dsw-alias-bg-layer-3); resize: vertical;',
  '  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;',
  '  font-size: 12px; line-height: 1.65; color: var(--dsw-alias-label-primary);',
  '}',
  '.imqb2-textarea:focus { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }',
  '.imqb2-inline-btn {',
  '  appearance: none; border: 0; background: transparent; padding: 0; margin: 0 0 0 auto;',
  '  font: inherit; font-size: 12px; color: var(--dsw-alias-label-tertiary); cursor: pointer;',
  '}',
  '.imqb2-inline-btn:hover { color: var(--dsw-alias-label-primary); }',
  '.imqb2-select {',
  '  box-sizing: border-box; width: 100%; max-width: 420px; height: 32px; padding: 0 28px 0 10px;',
  '  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);',
  '  background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px;',
  '  color: var(--dsw-alias-label-primary); cursor: pointer; appearance: none;',
  '  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);',
  '  background-position: calc(100% - 15px) 14px, calc(100% - 10px) 14px;',
  '  background-size: 5px 5px, 5px 5px; background-repeat: no-repeat;',
  '}',
  '.imqb2-select:focus { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }',

  /* ── 分段控件 ── */
  '.imqb2-seg {',
  '  position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr;',
  '  gap: 2px; padding: 3px; border-radius: var(--dsw-radius-md, 8px); max-width: 100%;',
  '  background: var(--dsw-alias-interactive-bg-hover);',
  '}',
  '.imqb2-seg-indicator {',
  '  position: absolute; top: 3px; left: 3px;',
  '  width: calc((100% - 6px - 2px * (var(--imqb2-seg-count) - 1)) / var(--imqb2-seg-count));',
  '  height: calc(100% - 6px); border-radius: var(--dsw-radius-sm, 6px);',
  '  background: var(--dsw-alias-bg-layer-1);',
  '  box-shadow: var(--dsw-elevation-soft, 0 1px 3px rgba(0,0,0,.08));',
  '  transform: translateX(calc(var(--imqb2-seg-index) * (100% + 2px)));',
  '  transition: transform 160ms ease; pointer-events: none;',
  '}',
  '.imqb2-seg-tab {',
  '  box-sizing: border-box; position: relative; z-index: 1; height: 26px; padding: 0 14px;',
  '  border: 0; border-radius: var(--dsw-radius-sm, 6px); background: transparent;',
  '  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px;',
  '  font-weight: 500; white-space: nowrap; cursor: pointer; transition: color 120ms ease;',
  '}',
  ".imqb2-seg-tab:hover, .imqb2-seg-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); }",
  '.imqb2-seg-tab:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',

  /* ── 标签输入 ── */
  '.imqb2-tags {',
  '  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;',
  '  box-sizing: border-box; width: 100%; min-height: 34px; padding: 5px 6px;',
  '  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);',
  '  background: var(--dsw-alias-bg-layer-3); cursor: text;',
  '}',
  '.imqb2-tags:focus-within { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }',
  '.imqb2-tag {',
  '  display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto;',
  '  max-width: 100%; height: 24px; padding: 0 4px 0 9px; border-radius: 999px;',
  '  background: var(--dsw-alias-interactive-bg-hover);',
  '  font-size: 12px; line-height: 1; color: var(--dsw-alias-label-primary);',
  '}',
  '.imqb2-tag-text { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.imqb2-tag-x {',
  '  display: inline-flex; align-items: center; justify-content: center;',
  '  width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%;',
  '  background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px;',
  '  line-height: 1; cursor: pointer;',
  '}',
  '.imqb2-tag-x:hover { background: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }',
  '.imqb2-tags-input {',
  '  flex: 1 1 120px; min-width: 100px; height: 22px; padding: 0 4px;',
  '  border: 0; outline: none; background: transparent; font: inherit; font-size: 13px;',
  '  color: var(--dsw-alias-label-primary);',
  '}',
  '.imqb2-tags-input::placeholder { color: var(--dsw-alias-label-tertiary); }',

  /* ── 底栏 ── */
  '.imqb2-footer {',
  '  position: sticky; bottom: 0; display: flex; align-items: center; gap: 12px;',
  '  padding: 12px 0 10px; margin-top: 8px;',
  '  background: linear-gradient(to top, var(--dsw-alias-bg-layer-1) 72%, transparent);',
  '}',
  '.imqb2-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }',
  '.imqb2-note--error { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error)); }',
  '.imqb2-note--ok { color: var(--dsw-alias-label-secondary); }',
  '.imqb2-save {',
  '  appearance: none; flex: none; border: 1px solid transparent;',
  '  border-radius: var(--dsw-radius-md, 8px); padding: 6px 18px;',
  '  font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer;',
  '  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3);',
  '}',
  '.imqb2-save:disabled { opacity: 0.4; cursor: default; }',
  '.imqb2-save:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }',

  /* ── 模块卡片：一块一个主题，背景分开 ── */
  '.imqb2-card {',
  '  display: flex; flex-direction: column; gap: 4px;',
  '  padding: 14px 16px 8px; margin-bottom: 14px;',
  '  border: 1px solid var(--dsw-alias-border-secondary);',
  '  border-radius: 12px;',
  '  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1));',
  '  scroll-margin-top: 8px;',
  '}',
  '.imqb2-card-head { display: flex; align-items: center; gap: 6px; padding-bottom: 6px; }',
  '.imqb2-card-title { margin: 0; font-size: 13px; font-weight: 600; line-height: 20px; color: var(--dsw-alias-label-primary); }',
  '.imqb2-card-tip {',
  '  display: inline-flex; align-items: center; justify-content: center;',
  '  width: 15px; height: 15px; border-radius: 50%;',
  '  border: 1px solid var(--dsw-alias-border-secondary);',
  '  font-size: 10px; line-height: 1; color: var(--dsw-alias-label-tertiary);',
  '  cursor: help; user-select: none;',
  '}',

  /* ── 模块导航 ── */
  '.imqb2-nav {',
  '  position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 6px;',
  '  padding: 8px 0 10px; margin-bottom: 4px;',
  '  background: linear-gradient(to bottom, var(--dsw-alias-bg-layer-1) 78%, transparent);',
  '}',
  '.imqb2-nav-item {',
  '  appearance: none; border: 1px solid var(--dsw-alias-border-secondary);',
  '  border-radius: 999px; padding: 3px 10px;',
  '  font: inherit; font-size: 12px; line-height: 1.5; cursor: pointer;',
  '  background: transparent; color: var(--dsw-alias-label-secondary);',
  '}',
  '.imqb2-nav-item:hover { color: var(--dsw-alias-label-primary); }',
  '.imqb2-nav-item.is-active {',
  '  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-1);',
  '  border-color: transparent;',
  '}',

  /* ── 说明走 tooltip：虚线下划线提示「这里可以看」 ── */
  '.imqb2-has-tip { cursor: help; border-bottom: 1px dashed var(--dsw-alias-border-secondary); }',
  '.imqb2-input--text { width: 76px; text-align: center; }',
];

/** 注入配置面板样式（挂载时注入、卸载时移除） */
function useConfigPanelStyles(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID) !== null) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = PANEL_CSS.join('\n');
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);
}

/* ────────────────────────── 原子组件 ────────────────────────── */

/**
 * 作用域卡片：一个会话范围 = 一块。
 * 标题行右侧是模式下拉，卡片内只留这个模式真正用得上的名单，避免一行行平铺。
 */
function ScopeCard({ title, desc, mode, options, onMode, children }: {
  title: string; desc?: string; mode: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onMode: (next: string) => void;
  children?: ReactNode;
}): ReactNode {
  return createElement('div', { className: 'imqb2-scope' },
    createElement('div', { className: 'imqb2-scope-head' },
      createElement('div', { className: 'imqb2-scope-title-wrap' },
        createElement('span', { className: 'imqb2-scope-name' }, title),
        desc !== undefined ? createElement('span', { className: 'imqb2-scope-desc' }, desc) : null,
      ),
      createElement('select', {
        className: 'imqb2-select', value: mode, 'aria-label': title + ' 访问模式',
        onChange: (event: { target: { value: string } }) => { onMode(event.target.value); },
      }, options.map((option) => createElement('option', { key: option.value, value: option.value }, option.label))),
    ),
    children,
  );
}

function Switch({ checked, label, onChange }: {
  checked: boolean; label: string; onChange: (next: boolean) => void;
}): ReactNode {
  return createElement('button', {
    type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label,
    className: 'imqb2-switch',
    onClick: () => { onChange(!checked); },
  }, createElement('span', { className: 'imqb2-switch-thumb' }));
}

function Segmented({ value, options, onChange, label }: {
  value: string; options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (next: string) => void; label: string;
}): ReactNode {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const trackStyle = {
    '--imqb2-seg-count': options.length,
    '--imqb2-seg-index': index,
  } as CSSProperties;
  return createElement('div', { className: 'imqb2-seg', role: 'tablist', 'aria-label': label, style: trackStyle },
    createElement('span', { className: 'imqb2-seg-indicator' }),
    options.map((option) => createElement('button', {
      key: option.value, type: 'button', role: 'tab', 'aria-selected': option.value === value,
      className: 'imqb2-seg-tab', onClick: () => { onChange(option.value); },
    }, option.label)),
  );
}

/**
 * 统一行容器：左 label（可带副标题）右控件。
 *
 * 说明一律进 tooltip（label 上的 title + 虚线下划线），不再往页面里塞段落——
 * 一屏塞十几条解释，人是要骂人的。
 */
function Row({ label, sub, help, inline = false, children }: {
  label: string; sub?: string; help?: string; inline?: boolean; children?: ReactNode;
}): ReactNode {
  return createElement('div', { className: 'imqb2-row' },
    createElement('div', { className: 'imqb2-row-label' },
      createElement('span', {
        className: help === undefined ? undefined : 'imqb2-has-tip',
        title: help,
      }, label),
      sub === undefined ? null : createElement('span', { className: 'imqb2-row-label-sub' }, sub),
    ),
    createElement('div', { className: 'imqb2-row-control' + (inline ? ' imqb2-row-control--inline' : '') },
      children,
    ),
  );
}

/** 单行文本输入（表情、短串） */
function TextRow({ label, sub, help, value, placeholder, maxLength, onChange }: {
  label: string; sub?: string; help?: string; value: string;
  placeholder?: string; maxLength?: number; onChange: (next: string) => void;
}): ReactNode {
  return createElement(Row, { label, sub, help, inline: true },
    createElement('input', {
      type: 'text',
      className: 'imqb2-input imqb2-input--text',
      value,
      placeholder,
      maxLength,
      spellCheck: false,
      onChange: (event: ChangeEvent<HTMLInputElement>) => { onChange(event.currentTarget.value); },
    }),
  );
}

/** 模块卡片：一个主题 = 一块独立背景，标题上的问号挂说明 */
function Section({ id, title, desc, children }: {
  id: string; title: string; desc?: string; children?: ReactNode;
}): ReactNode {
  return createElement('section', { className: 'imqb2-card', id: 'imqb2-mod-' + id },
    createElement('div', { className: 'imqb2-card-head' },
      createElement('h3', { className: 'imqb2-card-title' }, title),
      desc === undefined ? null : createElement('span', {
        className: 'imqb2-card-tip', title: desc, 'aria-label': desc,
      }, '?'),
    ),
    createElement('div', { className: 'imqb2-rows' }, children),
  );
}

/** 模块导航：点一下滚到那块，当前项高亮 */
function ModuleNav({ items, active, onPick }: {
  items: ReadonlyArray<{ id: string; label: string }>;
  active: string;
  onPick: (id: string) => void;
}): ReactNode {
  return createElement('nav', { className: 'imqb2-nav', 'aria-label': '配置模块' },
    items.map((item) => createElement('button', {
      key: item.id, type: 'button',
      className: 'imqb2-nav-item' + (item.id === active ? ' is-active' : ''),
      'aria-current': item.id === active ? 'true' : 'false',
      onClick: () => { onPick(item.id); },
    }, item.label)),
  );
}

function SwitchRow({ label, sub, help, checked, onChange }: {
  label: string; sub?: string; help?: string; checked: boolean; onChange: (next: boolean) => void;
}): ReactNode {
  return createElement(Row, { label, sub, help, inline: true },
    createElement(Switch, { checked, label, onChange }),
  );
}

function NumberRow({ label, sub, help, value, min, max, step, suffix, onChange }: {
  label: string; sub?: string; help?: string; value: number;
  min?: number; max?: number; step?: number; suffix?: string;
  onChange: (next: number) => void;
}): ReactNode {
  return createElement(Row, { label, sub, help, inline: true },
    createElement('div', { className: 'imqb2-number' },
      createElement('input', {
        type: 'number',
        className: 'imqb2-input imqb2-input--number',
        value: Number.isFinite(value) ? String(value) : '',
        min, max, step,
        onChange: (event: ChangeEvent<HTMLInputElement>) => {
          const raw = event.currentTarget.value;
          const next = Number(raw);
          if (raw !== '' && Number.isFinite(next)) onChange(next);
        },
      }),
      suffix === undefined ? null : createElement('span', { className: 'imqb2-number-unit' }, suffix),
    ),
  );
}

function SegmentedRow({ label, sub, help, value, options, onChange }: {
  label: string; sub?: string; help?: string; value: string;
  options: ReadonlyArray<{ value: string; label: string }>; onChange: (next: string) => void;
}): ReactNode {
  return createElement(Row, { label, sub, help },
    createElement(Segmented, { value, options, onChange, label }),
  );
}

function TextAreaRow({ label, sub, help, value, rows, placeholder, onChange, action }: {
  label: string; sub?: string; help?: string; value: string; rows?: number;
  placeholder?: string; onChange: (next: string) => void; action?: ReactNode;
}): ReactNode {
  return createElement(Row, { label, sub, help },
    createElement('textarea', {
      className: 'imqb2-textarea',
      value,
      rows: rows ?? 12,
      placeholder,
      spellCheck: false,
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => { onChange(event.currentTarget.value); },
    }),
    action === undefined ? null : action,
  );
}

function SelectRow({ label, sub, help, value, options, onChange }: {
  label: string; sub?: string; help?: string; value: string;
  options: ReadonlyArray<{ value: string; label: string }>; onChange: (next: string) => void;
}): ReactNode {
  return createElement(Row, { label, sub, help },
    createElement('select', {
      className: 'imqb2-select',
      value,
      onChange: (event: ChangeEvent<HTMLSelectElement>) => { onChange(event.currentTarget.value); },
    }, options.map((option) => createElement('option', { key: option.value, value: option.value }, option.label))),
  );
}

/**
 * 标签输入：回车或逗号成标签，Backspace 删最后一个，点 × 删单个。
 *
 * 用内部文本态承接输入过程，提交时才变成数组；否则每敲一个字都要重建数组，
 * 光标和输入法（拼音候选）都会被打断。
 */
function TagsRow({ label, sub, help, value, placeholder, onChange }: {
  label: string; sub?: string; help?: string; value: string[];
  placeholder?: string; onChange: (next: string[]) => void;
}): ReactNode {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commit = useCallback((raw: string): void => {
    const items = raw.split(/[,\n\uFF0C]/).map((part) => part.trim()).filter((part) => part !== '');
    if (items.length === 0) return;
    const next = [...value];
    for (const item of items) if (!next.includes(item)) next.push(item);
    if (next.length !== value.length) onChange(next);
    setDraft('');
  }, [onChange, value]);

  const remove = useCallback((target: string): void => {
    onChange(value.filter((item) => item !== target));
  }, [onChange, value]);

  return createElement(Row, { label, sub, help },
    createElement('div', {
      className: 'imqb2-tags',
      onClick: () => { inputRef.current?.focus(); },
      role: 'group',
      'aria-label': label,
    },
      value.map((item) => createElement('span', { key: item, className: 'imqb2-tag' },
        createElement('span', { className: 'imqb2-tag-text' }, item),
        createElement('button', {
          type: 'button', className: 'imqb2-tag-x', 'aria-label': '删除 ' + item,
          onClick: (event: { stopPropagation: () => void }) => { event.stopPropagation(); remove(item); },
        }, '×'),
      )),
      createElement('input', {
        ref: inputRef,
        className: 'imqb2-tags-input',
        value: draft,
        placeholder: value.length === 0 ? placeholder : '继续输入…',
        spellCheck: false,
        onChange: (event: ChangeEvent<HTMLInputElement>) => {
          const raw = event.currentTarget.value;
          // 逗号/中文逗号回车即入标签；剩余文本留在草稿里继续编辑
          if (/[,\uFF0C\n]/.test(raw)) commit(raw);
          else setDraft(raw);
        },
        onKeyDown: (event: { key: string; preventDefault: () => void }) => {
          if (event.key === 'Enter') { event.preventDefault(); commit(draft); }
          else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
            event.preventDefault();
            remove(value[value.length - 1] as string);
          }
        },
        onBlur: () => { if (draft.trim() !== '') commit(draft); },
      }),
    ),
  );
}

/** 深比较（dirty 判断） */
function shallowEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ────────────────────────── 面板主体 ────────────────────────── */

export function ConfigPanel(props: { bindPhase?: string } = {}): ReactNode {
  useConfigPanelStyles();
  const [initial, setInitial] = useState<ConfigWire | null>(null);
  const [form, setForm] = useState<ConfigWire | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeModule, setActiveModule] = useState('scope');
  const bindPhase = props?.bindPhase;

  useEffect(() => {
    let stopped = false;
    void fetch(BIND_CONFIG_PATH, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const body = (await res.json()) as { config: ConfigWire };
        if (stopped) return;
        setInitial(body.config);
        setForm(body.config);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (!stopped) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => { stopped = true; };
  }, [bindPhase]);

  const patch = useCallback(<K extends keyof ConfigWire>(key: K, value: ConfigWire[K]): void => {
    setForm((current) => current === null ? current : { ...current, [key]: value });
    setResult(null);
  }, []);

  const submit = useCallback((event: FormEvent): void => {
    event.preventDefault();
    if (busy || initial === null || form === null) return;
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(form) as Array<keyof ConfigWire>) {
      if (key === 'workspaceOptions') continue;      // 服务端回传的只读候选
      if (!shallowEqual(form[key], initial[key])) changed[key] = form[key];
    }
    if (Object.keys(changed).length === 0) return;

    setBusy(true);
    void fetch(BIND_CONFIG_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(changed),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
        if (res.ok && body.ok === true) {
          setResult({ ok: true, message: body.message ?? '配置已保存，插件将自动重载' });
          setInitial(form);
          return;
        }
        setResult({ ok: false, message: body.error ?? '保存失败（HTTP ' + res.status + '）' });
      })
      .catch((err: unknown) => {
        setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => { setBusy(false); });
  }, [busy, form, initial]);

  if (loadError !== null) {
    return createElement('p', { className: 'imqb2-help', style: { padding: '12px 0' } }, '配置加载失败：' + loadError);
  }
  if (initial === null || form === null) {
    return createElement('p', { className: 'imqb2-help', style: { padding: '12px 0' } }, '正在加载配置…');
  }

  const dirty = (Object.keys(form) as Array<keyof ConfigWire>)
    .some((key) => key !== 'workspaceOptions' && !shallowEqual(form[key], initial[key]));

  const policy: MentionPolicy = form.mentionPolicy ?? 'smart';
  const cwd = form.cwd ?? '';
  const workspaceOptions = form.workspaceOptions ?? [];
  const selectOptions = [
    { value: '', label: '默认（~/.dsh-tuitui/workspace）' },
    ...workspaceOptions.filter((dir) => dir !== '').map((dir) => ({ value: dir, label: dir })),
    // 当前值不在候选里（手改过 profile）也要能显示，避免下拉框回显成空
    ...(cwd !== '' && !workspaceOptions.includes(cwd) ? [{ value: cwd, label: cwd + '（当前）' }] : []),
  ];

  const modules = [
    { id: 'scope', label: '服务范围' },
    { id: 'reply', label: '回话方式' },
    ...(policy === 'smart' ? [{ id: 'smart', label: '智能判断' }] : []),
    { id: 'reaction', label: '表情回执' },
    { id: 'context', label: '上下文' },
    { id: 'workspace', label: '工作区' },
    { id: 'native', label: '原生能力' },
    { id: 'output', label: '输出调试' },
  ];
  const jumpTo = (id: string): void => {
    setActiveModule(id);
    const target = typeof document === 'undefined' ? null : document.getElementById('imqb2-mod-' + id);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return createElement('form', { className: 'imqb2-form', onSubmit: submit },

    createElement(ModuleNav, { items: modules, active: activeModule, onPick: jumpTo }),

    createElement(Section, {
      id: 'scope',
      title: '服务范围',
      desc: '机器人愿意在哪些会话里工作；每块的模式决定名单怎么用。',
    },
      createElement(ScopeCard, {
        title: '单聊', desc: '同事私聊机器人', mode: form['access.c2cMode'] ?? 'open', options: MODE_OPTIONS,
        onMode: (v) => { patch('access.c2cMode', v as AccessMode); },
      },
        (form['access.c2cMode'] ?? 'open') === 'allowlist'
          ? createElement(TagsRow, {
              label: '名单', value: form['access.c2cAllow'] ?? [],
              placeholder: '域账号或 uid，回车添加',
              help: (form['access.c2cAllow'] ?? []).length === 0
                ? '名单为空 = 谁都不理（失败即关闭）。'
                : undefined,
              onChange: (v) => { patch('access.c2cAllow', v); },
            })
          : (form['access.c2cMode'] ?? 'open') === 'blocklist'
            ? createElement(TagsRow, {
                label: '屏蔽', value: form['access.c2cBlock'] ?? [],
                placeholder: '域账号或 uid，回车添加',
                help: '只拦这些人，其余照常。',
                onChange: (v) => { patch('access.c2cBlock', v); },
              })
            : createElement('p', { className: 'imqb2-help', style: { padding: '4px 0 8px' } },
                (form['access.c2cMode'] ?? 'open') === 'disabled'
                  ? '单聊完全关闭：发消息不会有任何回应。'
                  : '谁私聊都回应。'),
      ),

      createElement(ScopeCard, {
        title: '群聊', desc: '拉进群之后在群里说话', mode: form['access.groupMode'] ?? 'open', options: MODE_OPTIONS,
        onMode: (v) => { patch('access.groupMode', v as AccessMode); },
      },
        (form['access.groupMode'] ?? 'open') === 'allowlist'
          ? createElement(TagsRow, {
              label: '名单', value: form['access.groupAllow'] ?? [],
              placeholder: 'group_id，回车添加',
              help: (form['access.groupAllow'] ?? []).length === 0
                ? '名单为空 = 哪个群都不理（失败即关闭）。'
                : undefined,
              onChange: (v) => { patch('access.groupAllow', v); },
            })
          : (form['access.groupMode'] ?? 'open') === 'blocklist'
            ? createElement(TagsRow, {
                label: '屏蔽', value: form['access.groupBlock'] ?? [],
                placeholder: 'group_id，回车添加',
                help: '只屏蔽这些群，其余照常。',
                onChange: (v) => { patch('access.groupBlock', v); },
              })
            : createElement('p', { className: 'imqb2-help', style: { padding: '4px 0 8px' } },
                (form['access.groupMode'] ?? 'open') === 'disabled'
                  ? '群聊完全关闭：@ 它也不回应。'
                  : '任何群 @ 它都回应（具体听不听 @ 见下方「什么时候回话」）。'),
      ),

      createElement(ScopeCard, {
        title: '团队频道帖子', desc: '按 channel_id 或 team_id 匹配', mode: form['access.postMode'] ?? 'disabled', options: MODE_OPTIONS,
        onMode: (v) => { patch('access.postMode', v as AccessMode); },
      },
        (form['access.postMode'] ?? 'disabled') === 'allowlist'
          ? createElement(TagsRow, {
              label: '名单', value: form['access.postAllow'] ?? [],
              placeholder: 'channel_id 或 team_id，回车添加',
              help: (form['access.postAllow'] ?? []).length === 0
                ? '名单为空 = 哪个频道都不理（失败即关闭）。'
                : undefined,
              onChange: (v) => { patch('access.postAllow', v); },
            })
          : (form['access.postMode'] ?? 'disabled') === 'blocklist'
            ? createElement(TagsRow, {
                label: '屏蔽', value: form['access.postBlock'] ?? [],
                placeholder: 'channel_id 或 team_id，回车添加',
                help: '只屏蔽这些频道，其余照常。',
                onChange: (v) => { patch('access.postBlock', v); },
              })
            : createElement('p', { className: 'imqb2-help', style: { padding: '4px 0 8px' } },
                (form['access.postMode'] ?? 'disabled') === 'disabled'
                  ? '帖子完全关闭：频道里发帖不会回应。'
                  : '所有频道的帖子都会处理。'),
      ),
    ),

    createElement(Section, {
      id: 'reply',
      title: '回话方式',
      desc: '群聊与团队频道里什么时候开口；私聊始终直接对话。',
    },
      createElement(SegmentedRow, {
        label: '触发方式', value: policy, options: POLICY_OPTIONS,
        help: policy === 'require'
          ? '只有 @ 机器人才回应。'
          : policy === 'smart'
            ? '不 @ 也不看名字：模型读上下文，自己决定说话、挂个表情、还是一声不吭。'
            : '群里每条消息都回——建议只用在专用小群。',
        onChange: (v) => { patch('mentionPolicy', v as MentionPolicy); },
      }),
      createElement(SelectRow, {
        label: '单聊忙时', value: form['concurrency.c2c'] ?? 'abort', options: CONCURRENCY_OPTIONS,
        help: '私聊正在回上一句时又来一句：打断＝放弃旧的直接接新话，最像真人聊天。',
        onChange: (v) => { patch('concurrency.c2c', v as ConcurrencyStrategy); },
      }),
      createElement(SelectRow, {
        label: '群聊忙时', value: form['concurrency.group'] ?? 'queue', options: CONCURRENCY_OPTIONS,
        help: '群里任务多，默认排一条条处理；打断会让正在跑的活白跑。',
        onChange: (v) => { patch('concurrency.group', v as ConcurrencyStrategy); },
      }),
      createElement(SelectRow, {
        label: '帖子忙时', value: form['concurrency.post'] ?? 'queue', options: CONCURRENCY_OPTIONS,
        help: '团队频道帖子的处理方式，默认排队。',
        onChange: (v) => { patch('concurrency.post', v as ConcurrencyStrategy); },
      }),
    ),

    createElement(Section, {
      id: 'reaction',
      title: '表情回执',
      desc: '收到消息先挂表情表示「在算」，处理完或出错再换一个；也是智能模式里更轻的回话方式。',
    },
      createElement(SwitchRow, {
        label: '收到就先挂一个', checked: form['reactions.enabled'] ?? true,
        help: '打开后，机器人收到的消息会立刻被挂上「在算」表情，不用干等着以为它卡死了。',
        onChange: (v) => { patch('reactions.enabled', v); },
      }),
      createElement(SwitchRow, {
        label: '群聊也挂', checked: form['reactions.inGroup'] ?? true,
        help: '群聊里同样给回执。群里人多、消息快，这个反馈更有用。',
        onChange: (v) => { patch('reactions.inGroup', v); },
      }),
      createElement(TextRow, {
        label: '在算', value: form['reactions.ack'] ?? '👀',
        placeholder: '👀', maxLength: 8,
        help: '收到消息时挂的表情。留空 = 不挂。',
        onChange: (v) => { patch('reactions.ack', v); },
      }),
      createElement(TextRow, {
        label: '完成', value: form['reactions.done'] ?? '✅',
        placeholder: '✅', maxLength: 8,
        help: '处理完把「在算」换成这个。留空 = 只撤不换。',
        onChange: (v) => { patch('reactions.done', v); },
      }),
      createElement(TextRow, {
        label: '出错', value: form['reactions.fail'] ?? '😵',
        placeholder: '😵', maxLength: 8,
        help: '处理失败时换成这个。留空 = 只撤不换。',
        onChange: (v) => { patch('reactions.fail', v); },
      }),
    ),

    policy === 'smart'
      ? createElement(Section, {
          id: 'smart',
          title: '智能判断',
          desc: '要不要说话、挂个表情还是不理，全由模型读上下文决定；没有名字匹配之类的规则。',
        },
          createElement(TextAreaRow, {
            label: '判定提示词',
            value: form['smartJudge.prompt'] ?? DEFAULT_SMART_PROMPT,
            rows: 14,
            sub: '支持多行；留空恢复出厂默认',
            help: '模型会拿到【最近对话】与【新消息】，按这里的规则判断要不要回。',
            action: createElement('button', {
              type: 'button', className: 'imqb2-inline-btn',
              onClick: () => { patch('smartJudge.prompt', ''); },
            }, '恢复默认'),
            onChange: (v) => { patch('smartJudge.prompt', v); },
          }),
          createElement(NumberRow, {
            label: '判定间隔', value: Math.round((form['smartJudge.cooldownMs'] ?? 5000) / 1000),
            min: 0, max: 3600, step: 5, suffix: '秒',
            help: '同一会话两次判定的最小间隔，防止每条消息都调模型。',
            onChange: (v) => { patch('smartJudge.cooldownMs', v * 1000); },
          }),
          createElement(NumberRow, {
            label: '判定超时', value: Math.round((form['smartJudge.timeoutMs'] ?? 20000) / 1000),
            min: 3, max: 120, step: 1, suffix: '秒',
            help: '思考型模型几秒才出结果；给太短会把「还在想」误判成不回话。',
            onChange: (v) => { patch('smartJudge.timeoutMs', v * 1000); },
          }),
          createElement(NumberRow, {
            label: '判断时看几条', value: form['smartJudge.maxHistory'] ?? 50,
            min: 0, max: 50, step: 1, suffix: '条',
            help: '交给模型的历史消息条数。太少判断不准，太多费 token。',
            onChange: (v) => { patch('smartJudge.maxHistory', v); },
          }),
        )
      : null,

    createElement(Section, {
      id: 'context',
      title: '上下文与会话',
      desc: '回话时能看到多少群消息，会话在内存里保留多久。',
    },
      createElement(NumberRow, {
        label: '群聊上下文条数', value: form.historyLimit ?? 50, min: 0, max: 1000, step: 1, suffix: '条',
        help: '被叫到时附带最近 N 条群消息；0 表示不带。私聊靠会话自身记忆，不受影响。',
        onChange: (v) => { patch('historyLimit', v); },
      }),
      createElement(NumberRow, {
        label: '闲置回收', value: Math.round((form.sessionIdleTimeout ?? 1800000) / 60000),
        min: 1, max: 1440, step: 1, suffix: '分钟',
        help: '超过该时长没有新消息就回收内存里的 agent；下次说话会自动恢复原会话，上下文不丢。',
        onChange: (v) => { patch('sessionIdleTimeout', v * 60000); },
      }),
    ),

    createElement(Section, {
      id: 'prompt',
      title: '额外提示词',
      desc: '按会话类型追加在机器人人格后面的内容：群里的规矩、私聊的口气、频道里的格式。留空 = 不加。',
    },
      createElement(TextAreaRow, {
        label: '群聊', value: form.groupPrompt ?? '', rows: 4,
        placeholder: '例如：群里说话短一点，别抢别人的话',
        help: '只在群聊里追加。',
        onChange: (v) => { patch('groupPrompt', v); },
      }),
      createElement(TextAreaRow, {
        label: '私聊', value: form.directPrompt ?? '', rows: 4,
        placeholder: '例如：一对一可以多说两句细节',
        help: '只在单聊里追加。',
        onChange: (v) => { patch('directPrompt', v); },
      }),
      createElement(TextAreaRow, {
        label: '团队频道', value: form.postPrompt ?? '', rows: 4,
        placeholder: '例如：帖子里用条目，别写长段',
        help: '只在团队频道的帖子里追加。',
        onChange: (v) => { patch('postPrompt', v); },
      }),
    ),

    createElement(Section, {
      id: 'vision',
      title: '看图',
      desc: '群里有人发图时，机器人能自己看明白再回话；用的是 dsh 里注册的视觉模型。',
    },
      createElement(SwitchRow, {
        label: '启用视觉理解', checked: form['vision.enabled'] ?? false,
        help: '打开后注册 tuitui_describe_image 工具，机器人才有"眼睛"。',
        onChange: (v) => { patch('vision.enabled', v); },
      }),
      createElement(TextRow, {
        label: '模型 provider', value: form['vision.provider'] ?? '',
        placeholder: 'pi-ai',
        help: 'dsh 里注册的 llm adapter 名，留空用默认。',
        onChange: (v) => { patch('vision.provider', v); },
      }),
      createElement(TextRow, {
        label: '模型 id', value: form['vision.model'] ?? '',
        placeholder: 'qwen-vl-max',
        help: '视觉模型 id，留空用默认。',
        onChange: (v) => { patch('vision.model', v); },
      }),
    ),

    createElement(Section, {
      id: 'workspace',
      title: '工作区',
      desc: '机器人在哪个目录里读写文件、执行命令；所有会话共用。',
    },
      createElement(SelectRow, {
        label: 'Agent 工作目录', value: cwd, options: selectOptions,
        help: cwd === '' ? '当前使用默认目录 ~/.dsh-tuitui/workspace。' : '保存后插件重载生效。',
        onChange: (v) => { patch('cwd', v); },
      }),
    ),

    createElement(Section, {
      id: 'native',
      title: '推推原生能力',
      desc: '推推特有的交互能力，关掉会退化成纯文本。',
    },
      createElement(SwitchRow, {
        label: '交互卡片', checked: form['interactive.enabled'] ?? true,
        help: '问答与审批用推推原生卡片承载，支持原地更新。',
        onChange: (v) => { patch('interactive.enabled', v); },
      }),
      createElement(SwitchRow, {
        label: '中间步骤上报', checked: form['agentSteps.enabled'] ?? false,
        help: '把模型与工具调用步骤实时展示在推推客户端。',
        onChange: (v) => { patch('agentSteps.enabled', v); },
      }),
    ),

    createElement(Section, {
      id: 'output',
      title: '输出与调试',
      desc: '回复怎么送到推推，以及排查问题时要看多少细节。',
    },
      createElement(SwitchRow, {
        label: '流式输出', checked: form.streaming ?? true,
        help: '先发一条消息，再原地编辑分段刷新，回复体感更快。',
        onChange: (v) => { patch('streaming', v); },
      }),
      createElement(SwitchRow, {
        label: '显示工具调用结果', checked: form.showToolResults ?? false,
        help: '把 agent 调用工具的结果也发到聊天里，排查问题时有用。',
        onChange: (v) => { patch('showToolResults', v); },
      }),
      createElement(SwitchRow, {
        label: '限制可发送的文件', checked: form['sendFile.restrictPaths'] ?? false,
        help: '默认放开：想让 agent 发哪的文件都行。打开后只允许媒体目录、工作区和额外根目录，防误发敏感文件。',
        onChange: (v) => { patch('sendFile.restrictPaths', v); },
      }),
      createElement(SwitchRow, {
        label: '调试日志', checked: form.debug ?? false,
        help: '输出推推 SDK 请求详情（含消息内容），只在排查问题时开。',
        onChange: (v) => { patch('debug', v); },
      }),
    ),

    createElement('div', { className: 'imqb2-footer' },
      result !== null
        ? createElement('p', { className: 'imqb2-note' + (result.ok ? ' imqb2-note--ok' : ' imqb2-note--error') },
            (result.ok ? '' : '⚠️ ') + result.message)
        : dirty
          ? createElement('p', { className: 'imqb2-note' }, '保存后插件将重载，进行中的机器人会话将重置')
          : createElement('p', { className: 'imqb2-note' }),
      createElement('button', { className: 'imqb2-save', type: 'submit', disabled: busy || !dirty },
        busy ? '正在保存…' : '保存'),
    ),
  );
}

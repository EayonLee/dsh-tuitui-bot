/**
 * 推推机器人配置面板 — 必要配置的 UI 编辑
 *
 * UI 复刻 DSW 通用设置（settings-form 原语）的视觉风格：
 * 左对齐设置列、0.5px 行分隔、label 13px/500、控件右置；
 * Switch 为 36×20 aria-checked 结构（thumb translateX 动画）；
 * 三值选择用分段控件（滑动指示器按段数/索引的 CSS 变量定位）；
 * 保存按钮为 DSW 反色主按钮（label-primary 底 + bg-layer-3 字）。
 *
 * 数据流：GET /tuitui/im-tuitui/config 回显当前生效配置（appSecret
 * 已由宿主剔除）→ 表单编辑 → dirty diff → POST 仅提交变更键 →
 * 宿主白名单 + Schema 校验 → 最小写入 profile patch → HMR 重载生效。
 *
 * 键名口径：线上读写都用 dotted key（access.c2cMode 等），与服务端
 * shared/bind-protocol.ts 的 ConfigPatchWire 完全一致——客户端与服务端
 * 各自维护一套嵌套/扁平映射必然漂移，这里干脆只用一个形态。
 *
 * 字段策略：只开放用户必要的配置（服务范围 / 上下文 / 模型 / 工作区 /
 * 推推原生能力）；其余调优类字段走 profile patch / 环境变量。
 */
import { createElement, useCallback, useEffect, useState, type CSSProperties, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { BIND_CONFIG_PATH } from '../shared/bind-protocol.ts';

/** 访问模式三值（与 src/config.ts 的 AccessControlConfig 一致） */
type AccessMode = 'open' | 'allowlist' | 'blocklist' | 'disabled';

/** GET 回显 / POST 提交的扁平配置（appSecret 已剔除） */
interface ConfigWire {
  provider?: string;
  model?: string;
  preset?: string;
  cwd?: string;
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
  mentionPolicy?: 'require' | 'always' | 'smart';
  botAliases?: string[];
  smartFollowUpMs?: number;
  'interactive.enabled'?: boolean;
  'agentSteps.enabled'?: boolean;
}

/** 样式注入标记（幂等） */
const STYLE_ID = 'im-tuitui-config-panel-styles';

/** DSW 通用设置风格（settings-form / Switch / SegmentedControl 原语复刻） */
const PANEL_CSS: readonly string[] = [
  '.imqb2-form { display: flex; flex-direction: column; width: 100%; }',
  '.imqb2-group-title {',
  '  padding: 14px 0 2px; font-size: 12px; font-weight: 600; line-height: 18px;',
  '  color: var(--dsw-alias-label-tertiary); text-transform: uppercase; letter-spacing: .04em;',
  '}',
  '.imqb2-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }',
  '.imqb2-field + .imqb2-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }',
  '.imqb2-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }',
  '.imqb2-label {',
  '  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;',
  '  color: var(--dsw-alias-label-primary);',
  '}',
  '.imqb2-help { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }',
  '.imqb2-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }',
  '/* Switch（aria-checked 驱动，视觉态与无障碍态同源） */',
  '.imqb2-switch {',
  '  box-sizing: border-box; position: relative; flex: 0 0 auto;',
  '  width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px;',
  '  background: var(--dsw-alias-border-l3); cursor: pointer; font: inherit;',
  '}',
  ".imqb2-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }",
  '.imqb2-switch:disabled { cursor: default; opacity: 0.5; }',
  '.imqb2-switch:focus-visible {',
  '  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));',
  '  outline-offset: 2px;',
  '}',
  '.imqb2-switch-thumb {',
  '  display: block; width: 16px; height: 16px; border-radius: 50%;',
  '  background: var(--dsw-alias-switch-thumb, #ffffff);',
  '  transition: transform 120ms ease;',
  '}',
  ".imqb2-switch[aria-checked='true'] .imqb2-switch-thumb {",
  '  background: var(--dsw-alias-label-primary-foreground, #ffffff);',
  '  transform: translateX(16px);',
  '}',
  '/* 输入（官方 fields.input 复刻） */',
  '.imqb2-input {',
  '  box-sizing: border-box; width: 100%; height: 34px; padding: 0 12px;',
  '  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);',
  '  background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.5;',
  '  color: var(--dsw-alias-label-primary);',
  '}',
  '.imqb2-input:focus {',
  '  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));',
  '  outline-offset: 1px;',
  '}',
  '/* 分段控件 */',
  '.imqb2-seg {',
  '  position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr;',
  '  gap: 2px; padding: 4px; border-radius: var(--dsw-radius-md, 8px);',
  '  background: var(--dsw-alias-interactive-bg-hover);',
  '}',
  '.imqb2-seg-indicator {',
  '  position: absolute; top: 4px; left: 4px;',
  '  width: calc((100% - 8px - 2px * (var(--imqb2-seg-count) - 1)) / var(--imqb2-seg-count));',
  '  height: calc(100% - 8px);',
  '  border: 0; border-radius: var(--dsw-radius-sm, 6px);',
  '  background: var(--dsw-alias-bg-layer-1);',
  '  box-shadow: var(--dsw-elevation-soft, 0 1px 3px rgba(0,0,0,.08));',
  '  transform: translateX(calc(var(--imqb2-seg-index) * (100% + 2px)));',
  '  transition: transform 160ms ease;',
  '  pointer-events: none;',
  '}',
  '.imqb2-seg-tab {',
  '  box-sizing: border-box; position: relative; z-index: 1; height: 28px; padding: 0 16px;',
  '  border: 0; border-radius: var(--dsw-radius-sm, 6px); background: transparent;',
  '  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px;',
  '  font-weight: 500; white-space: nowrap; cursor: pointer; transition: color 120ms ease;',
  '}',
  ".imqb2-seg-tab:hover, .imqb2-seg-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); }",
  '.imqb2-seg-tab:focus-visible {',
  '  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));',
  '  outline-offset: -2px;',
  '}',
  '/* 底栏（官方 SettingsForm.footer 复刻） */',
  '.imqb2-footer { display: flex; align-items: center; gap: 8px; padding-top: 16px; }',
  '.imqb2-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }',
  '.imqb2-note--error { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error)); }',
  '.imqb2-note--ok { color: var(--dsw-alias-label-secondary); }',
  '.imqb2-save {',
  '  appearance: none; flex: none; border: 1px solid transparent;',
  '  border-radius: var(--dsw-radius-md, 8px); padding: 5px 14px;',
  '  font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer;',
  '  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3);',
  '}',
  '.imqb2-save:disabled { opacity: 0.4; cursor: default; }',
  '.imqb2-save:focus-visible {',
  '  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));',
  '  outline-offset: 1px;',
  '}',
  '/* cwd 只读行 */',
  '.imqb2-readonly {',
  '  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;',
  '  color: var(--dsw-alias-label-secondary); word-break: break-all; margin: 0;',
  '}',
];

/** 注入配置面板样式（挂载时注入、卸载时移除；与绑定面板的全局常驻样式不同） */
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

/** 开关（官方 Switch 原语结构：aria-checked 驱动视觉态） */
function Switch({ checked, label, onChange }: {
  checked: boolean; label: string; onChange: (next: boolean) => void;
}): ReactNode {
  return createElement('button', {
    type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label,
    className: 'imqb2-switch',
    onClick: () => { onChange(!checked); },
  }, createElement('span', { className: 'imqb2-switch-thumb' }));
}

/** 访问模式分段选择（官方 SegmentedControl 结构：CSS 变量定位滑动指示器） */
function Segmented({ value, options, onChange, label }: {
  value: AccessMode; options: ReadonlyArray<{ value: AccessMode; label: string }>;
  onChange: (next: AccessMode) => void; label: string;
}): ReactNode {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const trackStyle = {
    '--imqb2-seg-count': options.length,
    '--imqb2-seg-index': index,
  } as CSSProperties;
  return createElement('div', { className: 'imqb2-seg', role: 'tablist', 'aria-label': label, style: trackStyle },
    createElement('span', { className: 'imqb2-seg-indicator' }),
    options.map((o) => createElement('button', {
      key: o.value, type: 'button', role: 'tab', 'aria-selected': o.value === value,
      className: 'imqb2-seg-tab', onClick: () => { onChange(o.value); },
    }, o.label)),
  );
}

/** 开关行（label 左 + Switch 右 + 可选 help） */
function SwitchRow({ label, help, checked, onChange }: {
  label: string; help?: string; checked: boolean; onChange: (next: boolean) => void;
}): ReactNode {
  return createElement('div', { className: 'imqb2-field' },
    createElement('div', { className: 'imqb2-head' },
      createElement('span', { className: 'imqb2-label' }, label),
      createElement(Switch, { checked, label, onChange }),
    ),
    help === undefined ? null : createElement('p', { className: 'imqb2-help' }, help),
  );
}

/** 文本行（label 上 + 输入下，与官方 fields 布局一致） */
function FieldRow({ label, help, value, placeholder, onChange }: {
  label: string; help?: string; value: string; placeholder?: string; onChange: (next: string) => void;
}): ReactNode {
  return createElement('div', { className: 'imqb2-field' },
    createElement('span', { className: 'imqb2-label' }, label),
    createElement('input', {
      className: 'imqb2-input', value, placeholder, spellCheck: false,
      onChange: (event: ChangeEvent<HTMLInputElement>) => { onChange(event.currentTarget.value); },
    }),
    help === undefined ? null : createElement('p', { className: 'imqb2-hint' }, help),
  );
}

/** 数字行（label 左 + 数字输入右 + 可选 help） */
function NumberRow({ label, help, value, min, max, step, onChange }: {
  label: string; help?: string; value: number; min?: number; max?: number; step?: number;
  onChange: (next: number) => void;
}): ReactNode {
  return createElement('div', { className: 'imqb2-field' },
    createElement('div', { className: 'imqb2-head' },
      createElement('span', { className: 'imqb2-label' }, label),
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
    ),
    help === undefined ? null : createElement('p', { className: 'imqb2-hint' }, help),
  );
}

/** 名单行（逗号/换行分隔，内部维护文本态避免每次输入都抖动数组） */
function ListRow({ label, help, value, placeholder, onChange }: {
  label: string; help?: string; value: string[]; placeholder?: string;
  onChange: (next: string[]) => void;
}): ReactNode {
  const joined = value.join(', ');
  const [text, setText] = useState(joined);
  // 外部值变化时回写输入框；但用户正在输入（如刚敲了逗号）时不能被自己的回显吃掉
  useEffect(() => {
    const fromText = text.split(/[,\n]/).map((part) => part.trim()).filter((part) => part !== '').join(', ');
    if (fromText === joined) return;
    setText(joined);
  }, [joined]);
  return createElement('div', { className: 'imqb2-field' },
    createElement('div', { className: 'imqb2-head' },
      createElement('span', { className: 'imqb2-label' }, label),
    ),
    createElement('input', {
      className: 'imqb2-input', value: text, placeholder, spellCheck: false,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const raw = event.currentTarget.value;
        setText(raw);
        onChange(raw.split(/[,\n]/).map((part) => part.trim()).filter((part) => part !== ''));
      },
    }),
    help === undefined ? null : createElement('p', { className: 'imqb2-hint' }, help),
  );
}

/** 触发策略分段行（require / always / smart） */
function PolicyRow({ label, help, value, onChange }: {
  label: string; help?: string; value: 'require' | 'always' | 'smart';
  onChange: (next: 'require' | 'always' | 'smart') => void;
}): ReactNode {
  return createElement('div', { className: 'imqb2-field' },
    createElement('div', { className: 'imqb2-head' },
      createElement('span', { className: 'imqb2-label' }, label),
      createElement(Segmented, {
        value: value as never,
        options: POLICY_OPTIONS as never,
        onChange: (next) => { onChange(next as unknown as 'require' | 'always' | 'smart'); },
        label,
      }),
    ),
    help === undefined ? null : createElement('p', { className: 'imqb2-hint' }, help),
  );
}

/** 访问模式分段选择行 */

function SegmentedRow({ label, help, value, options, onChange }: {
  label: string; help?: string; value: AccessMode;
  options: ReadonlyArray<{ value: AccessMode; label: string }>; onChange: (next: AccessMode) => void;
}): ReactNode {
  return createElement('div', { className: 'imqb2-field' },
    createElement('div', { className: 'imqb2-head' },
      createElement('span', { className: 'imqb2-label' }, label),
      createElement(Segmented, { value, options, onChange, label }),
    ),
    help === undefined ? null : createElement('p', { className: 'imqb2-hint' }, help),
  );
}

const MODE_OPTIONS: ReadonlyArray<{ value: AccessMode; label: string }> = [
  { value: 'open', label: '所有人' },
  { value: 'allowlist', label: '白名单' },
  { value: 'blocklist', label: '黑名单' },
  { value: 'disabled', label: '禁用' },
];

/** 触发方式三档 */
const POLICY_OPTIONS: ReadonlyArray<{ value: 'require' | 'always' | 'smart'; label: string }> = [
  { value: 'require', label: '仅 @' },
  { value: 'always', label: '全部' },
  { value: 'smart', label: '智能' },
];

/** 深比较（表单值与初始回显值的 dirty 判断） */
function shallowEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 配置面板主体。
 *
 * 保存仅提交变更键（服务端按白名单合并），保存成功后提示
 * HMR 重载语义（进行中的机器人会话将重置）。
 */
export function ConfigPanel(props: { bindPhase?: string } = {}): ReactNode {
  useConfigPanelStyles();
  const [initial, setInitial] = useState<ConfigWire | null>(null);
  const [form, setForm] = useState<ConfigWire | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 绑定相位变化时重拉配置（绑定落库的白名单等新值）
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
    return createElement('p', { className: 'imqb2-hint', style: { padding: '12px 0' } },
      '配置加载失败：' + loadError);
  }
  if (initial === null || form === null) {
    return createElement('p', { className: 'imqb2-hint', style: { padding: '12px 0' } }, '正在加载配置…');
  }

  const dirty = (Object.keys(form) as Array<keyof ConfigWire>)
    .some((key) => !shallowEqual(form[key], initial[key]));

  return createElement('form', { className: 'imqb2-form', onSubmit: submit },
    createElement('div', { className: 'imqb2-group-title' }, '服务范围'),
    createElement(SegmentedRow, {
      label: '单聊', value: form['access.c2cMode'] ?? 'open', options: MODE_OPTIONS,
      help: '白名单只在「白名单」模式生效；黑名单始终优先',
      onChange: (v) => { patch('access.c2cMode', v); },
    }),
    createElement(ListRow, {
      label: '单聊白名单', value: form['access.c2cAllow'] ?? [], placeholder: '域账号或 uid，逗号分隔',
      onChange: (v) => { patch('access.c2cAllow', v); },
    }),
    createElement(ListRow, {
      label: '单聊黑名单', value: form['access.c2cBlock'] ?? [], placeholder: '域账号或 uid，逗号分隔',
      help: '被列入的人发消息一律不处理（优先级高于白名单）',
      onChange: (v) => { patch('access.c2cBlock', v); },
    }),
    createElement(SegmentedRow, {
      label: '群聊', value: form['access.groupMode'] ?? 'open', options: MODE_OPTIONS,
      onChange: (v) => { patch('access.groupMode', v); },
    }),
    createElement(ListRow, {
      label: '群聊白名单', value: form['access.groupAllow'] ?? [], placeholder: 'group_id，逗号分隔',
      onChange: (v) => { patch('access.groupAllow', v); },
    }),
    createElement(ListRow, {
      label: '群聊黑名单', value: form['access.groupBlock'] ?? [], placeholder: 'group_id，逗号分隔',
      onChange: (v) => { patch('access.groupBlock', v); },
    }),
    createElement(SegmentedRow, {
      label: '团队频道帖子', value: form['access.postMode'] ?? 'open', options: MODE_OPTIONS,
      help: '按 channel_id 或 team_id 匹配',
      onChange: (v) => { patch('access.postMode', v); },
    }),
    createElement(ListRow, {
      label: '帖子白名单', value: form['access.postAllow'] ?? [], placeholder: 'channel_id 或 team_id，逗号分隔',
      onChange: (v) => { patch('access.postAllow', v); },
    }),
    createElement(ListRow, {
      label: '帖子黑名单', value: form['access.postBlock'] ?? [], placeholder: 'channel_id 或 team_id，逗号分隔',
      onChange: (v) => { patch('access.postBlock', v); },
    }),

    createElement('div', { className: 'imqb2-group-title' }, '基础设置'),
    createElement(PolicyRow, {
      label: '群聊/帖子触发方式',
      value: form.mentionPolicy ?? ((form.requireMention ?? true) ? 'require' : 'always'),
      help: '仅 @：必须 @ 才回；全部：每条都回；智能：不 @ 也回，但只回与机器人相关的消息',
      onChange: (v) => { patch('mentionPolicy', v); },
    }),
    (form.mentionPolicy ?? ((form.requireMention ?? true) ? 'require' : 'always')) === 'smart'
      ? createElement(ListRow, {
          label: '机器人别名', value: form.botAliases ?? [], placeholder: '如 憨包, 小秘（逗号分隔）',
          help: '智能模式下，消息里出现这些名字就当作在叫机器人',
          onChange: (v) => { patch('botAliases', v); },
        })
      : null,
    (form.mentionPolicy ?? ((form.requireMention ?? true) ? 'require' : 'always')) === 'smart'
      ? createElement(NumberRow, {
          label: '追问延续窗口（秒）',
          value: Math.round((form.smartFollowUpMs ?? 120000) / 1000), min: 10, max: 3600, step: 10,
          help: '机器人回复后这段时间内，同一个人继续说话也算在跟机器人聊',
          onChange: (v) => { patch('smartFollowUpMs', v * 1000); },
        })
      : null,
    createElement(SwitchRow, {
      label: '流式输出', checked: form.streaming ?? true,
      help: '回复内容由 msgid 原地编辑分段实时推送',
      onChange: (v) => { patch('streaming', v); },
    }),
    createElement(SwitchRow, {
      label: '显示工具调用结果', checked: form.showToolResults ?? false,
      help: '在聊天中展示 agent 工具调用的结构化结果',
      onChange: (v) => { patch('showToolResults', v); },
    }),

    createElement('div', { className: 'imqb2-group-title' }, '上下文'),
    createElement(NumberRow, {
      label: '群聊上下文条数', value: form.historyLimit ?? 10, min: 0, max: 1000, step: 1,
      help: '群聊/频道里 @机器人 时，把最近 N 条消息一起带给模型；0 = 不带群历史。私聊不受影响（私聊靠会话自身记忆）',
      onChange: (v) => { patch('historyLimit', v); },
    }),
    createElement(NumberRow, {
      label: '会话闲置回收（分钟）', value: Math.round((form.sessionIdleTimeout ?? 1800000) / 60000), min: 1, max: 1440, step: 1,
      help: '超过该时长没有新消息就回收内存里的 agent；下次消息会自动 resume 原会话，上下文不丢',
      onChange: (v) => { patch('sessionIdleTimeout', v * 60000); },
    }),

    createElement('div', { className: 'imqb2-group-title' }, '模型'),
    createElement(FieldRow, {
      label: 'Provider', value: form.provider ?? '', placeholder: '留空继承宿主默认',
      onChange: (v) => { patch('provider', v); },
    }),
    createElement(FieldRow, {
      label: 'Model', value: form.model ?? '', placeholder: '留空继承宿主默认',
      onChange: (v) => { patch('model', v); },
    }),
    createElement(FieldRow, {
      label: 'Preset', value: form.preset ?? '', placeholder: 'Agent preset id',
      onChange: (v) => { patch('preset', v); },
    }),

    createElement('div', { className: 'imqb2-group-title' }, '推推原生能力'),
    createElement(SwitchRow, {
      label: '交互卡片', checked: form['interactive.enabled'] ?? true,
      help: '问答与审批用推推原生交互卡片，支持原地更新',
      onChange: (v) => { patch('interactive.enabled', v); },
    }),
    createElement(SwitchRow, {
      label: '中间步骤上报', checked: form['agentSteps.enabled'] ?? true,
      help: '把模型/工具调用步骤实时展示在推推客户端',
      onChange: (v) => { patch('agentSteps.enabled', v); },
    }),
    createElement(SwitchRow, {
      label: '调试日志', checked: form.debug ?? false,
      help: '输出推推 SDK 请求详情（含消息内容，仅排查问题时开启）',
      onChange: (v) => { patch('debug', v); },
    }),

    createElement('div', { className: 'imqb2-group-title' }, '工作区'),
    createElement(FieldRow, {
      label: 'Agent 工作目录',
      value: form.cwd ?? '',
      placeholder: '留空使用默认（~/.dsh-tuitui/workspace）',
      help: '所有会话（单聊/群聊/频道）共用这一个目录；必须是绝对路径，保存后插件重载生效',
      onChange: (v) => { patch('cwd', v); },
    }),

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

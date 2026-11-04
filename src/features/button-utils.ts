/**
 * 交互卡片按钮协议与点击事件归一化（QuestionChannel / ApprovalChannel 共用）。
 *
 * 推推用原生交互卡片：`action[].value` 直接接收对象，点击以 `interactive_action`
 * 事件推送，原始回调体挂在入站消息的 `raw` 上，由 `dispatchInteraction` 统一解码
 * 分发。
 *
 * 载体变了，协议字段不变：所有卡片按钮的 value 仍带顶层 `t` 判别字段，gateway 据此
 * 决定交给哪个通道，避免多通道各自 try 造成误判。
 */
import type {
  TuituiInteractiveAction,
} from '@qihoo/tuitui-bot-sdk';
import type { ChatScope, InboundMessage } from '../types.ts';
import { getScopePeer } from '../shared/scope.ts';

/** 卡片按钮文案上限：卡片底部按钮排成一行，过长会把整张卡片撑变形 */
export const BUTTON_LABEL_MAX = 10;

/** 截断按钮文案，超长补省略号（正文保留完整文本，按钮只是操作入口） */
export function buttonLabel(text: string | undefined): string {
  const s = String(text ?? '').trim();
  return s.length > BUTTON_LABEL_MAX ? s.slice(0, BUTTON_LABEL_MAX - 1) + '…' : s;
}

// ── 按钮 value 统一编码 ──

/**
 * 问答按钮：q=问题 id，i=选项下标。
 *
 * 用 type 而非 interface：SDK 的 value 类型是 `string | Record<string, unknown>`，
 * interface 不会被推断出隐式索引签名，赋给 value 时会报类型不兼容。
 */
export type QuestionButtonData = {
  t: 'question';
  q: string;
  i: number;
};

/** 审批按钮：d=决策，n=本审批的 nonce（与 pending 匹配，防旧卡片混淆 #94-3） */
export type ApprovalButtonData = {
  t: 'approval';
  d: 'allow' | 'deny';
  n?: string;
};

export type ButtonData = QuestionButtonData | ApprovalButtonData;

/**
 * 编码按钮 value。
 *
 * 推推的 value 允许直接放对象，因此这里返回对象本身——少一次序列化/转义，
 * 也让 SDK 侧不需要再 parse。
 * 显式重建而不是展开原对象：避免调用方多塞的字段（如调试信息）进到用户可点击的载荷里。
 */
export function encodeButtonData(data: ButtonData): ButtonData {
  if (data.t === 'question') return { t: 'question', q: data.q, i: data.i };
  return data.n === undefined
    ? { t: 'approval', d: data.d }
    : { t: 'approval', d: data.d, n: data.n };
}

/**
 * 解码按钮 value；非法载荷或缺少合法 `t` 时返回 undefined。
 *
 * 同时接受对象与 JSON 字符串：SDK 的 value 类型是 `string | Record`，若中转链路
 * 把它序列化成字符串，语义不应丢失。字段做类型校验而不是直接断言——推推卡片的
 * value 是开放结构，弱校验会把别的卡片载荷误判成本通道的点击。
 */
export function decodeButtonData(raw: unknown): ButtonData | undefined {
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
  if (!isRecord(parsed)) return undefined;
  const t = parsed.t;

  if (t === 'question') {
    if (typeof parsed.q !== 'string' || typeof parsed.i !== 'number') return undefined;
    return { t: 'question', q: parsed.q, i: parsed.i };
  }

  if (t === 'approval') {
    const d = parsed.d;
    if (d !== 'allow' && d !== 'deny') return undefined;
    return typeof parsed.n === 'string'
      ? { t: 'approval', d, n: parsed.n }
      : { t: 'approval', d };
  }

  return undefined;
}

// ── 卡片配色 ──

/** 卡片头部配色（来自 config.interactive，缺省用推推品牌蓝） */
export interface CardTheme {
  headBgColor: string;
  headTextColor: string;
}

export const DEFAULT_CARD_THEME: CardTheme = {
  headBgColor: '#1F6FEB',
  headTextColor: '#FFFFFF',
};

/** 把配置里的配色投影成主题；未配置的字段回落到默认值 */
export function resolveCardTheme(theme?: Partial<CardTheme>): CardTheme {
  return {
    headBgColor: theme?.headBgColor || DEFAULT_CARD_THEME.headBgColor,
    headTextColor: theme?.headTextColor || DEFAULT_CARD_THEME.headTextColor,
  };
}

// ── 点击事件归一化 ──

/**
 * 交互卡片点击的归一化视图。
 *
 * 推推 SDK 没有为 `interactive_action` 定义收窄的事件体类型，回调结构藏在
 * `InboundMessage.raw` 里；这里集中做一次安全提取，通道代码只依赖本结构。
 */
export interface InteractiveActionEvent {
  /** 点击发生的会话作用域 */
  scope: ChatScope;
  /** 与 ReplyTarget.targetId 同源（c2c=域账号，group=group_id，post=频道 id） */
  targetId: string;
  /** 点击者域账号（审批白名单主判据） */
  account?: string;
  /** 点击者 uid（无域账号的部署里作为白名单兜底） */
  uid?: string;
  /** 被点击卡片的 msgid（modifyInteractive 原地更新用） */
  messageId?: string;
  /** 被点击按钮的 value（encodeButtonData 的产物） */
  value: unknown;
}

/**
 * 从归一化入站消息提取点击视图；没有按钮载荷时返回 undefined。
 *
 * 会话定位复用 getScopePeer：它和会话管理、入站推导是同一份逻辑，
 * 否则群聊卡片点击会算出与 pending 不匹配的 sessionKey（审批永远 settle 不了）。
 */
export function getInteractiveAction(message: InboundMessage): InteractiveActionEvent | undefined {
  const value = interactiveValueOf(message);
  if (value === undefined) return undefined;

  const { scope, peerId } = getScopePeer(message);
  if (!peerId) return undefined;

  return {
    scope,
    targetId: peerId,
    ...(message.senderAccount ? { account: message.senderAccount } : {}),
    ...(message.senderId ? { uid: message.senderId } : {}),
    ...(message.messageId ? { messageId: message.messageId } : {}),
    value,
  };
}

/**
 * 从原始事件体里取被点击按钮的 value。
 *
 * SDK 会把回调体放在 `body.data`（TuituiInteractiveMessageCallback），但事件体的
 * data 类型是开放 Record，个别网关版本会把字段平铺到 body 上，所以两处都看。
 */
function interactiveValueOf(message: InboundMessage): unknown {
  const data = interactivePayloadOf(message.raw);
  if (!data) return undefined;

  const action = Array.isArray(data.action) ? data.action[0] : undefined;
  const fromAction = isRecord(action) ? action.value : undefined;
  if (fromAction !== undefined) return fromAction;
  return data.value;
}

/**
 * 取交互回调的载荷本体。
 *
 * 线上实测（2026-11-04）：回调被包在 `body.data.message` 里——
 * `{data:{message:{msgid, user, sender, conversation, action:[{value}]}}}`，
 * 而 SDK 的 `TuituiInteractiveCallbackMessage` 类型是平铺的。照类型读会得到一堆
 * undefined：msgid 退化成事件 cid、按钮 value 读不出来，点击在 dispatch 里无人
 * 认领而静默丢弃——表现就是"卡片能点，但点完什么都不发生"。
 */
export function interactivePayloadOf(raw: unknown): Record<string, unknown> | undefined {
  const body = isRecord(raw) ? raw : undefined;
  if (!body) return undefined;
  const data = isRecord(body.data) ? body.data : body;
  const nested = isRecord(data.message) ? data.message : undefined;
  return nested ?? data;
}

/**
 * 构建单行按钮：推推的 action 是一维数组，
 * name 是稳定的按钮标识（重放回调时可核对），text 是用户看到的文案。
 */
export function buildAction(options: {
  name: string;
  text: string;
  value: ButtonData;
}): TuituiInteractiveAction {
  return {
    name: options.name,
    text: options.text,
    value: encodeButtonData(options.value),
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

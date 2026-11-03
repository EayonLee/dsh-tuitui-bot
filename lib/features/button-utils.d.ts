/**
 * 交互卡片按钮协议与点击事件归一化（QuestionChannel / ApprovalChannel 共用）。
 *
 * 上游用 QQ InlineKeyboard：按钮回调数据是 JSON 字符串（button_data），点击以
 * INTERACTION_CREATE 事件回传、由 `dispatchInteraction` 统一解码分发。推推用原生
 * 交互卡片：`action[].value` 直接接收对象，点击以 `interactive_action` 事件推送，
 * 原始回调体挂在入站消息的 `raw` 上。
 *
 * 载体变了，协议字段不变：所有卡片按钮的 value 仍带顶层 `t` 判别字段，gateway 据此
 * 决定交给哪个通道，避免多通道各自 try 造成误判。
 */
import type { TuituiInteractiveAction } from '@qihoo/tuitui-bot-sdk';
import type { ChatScope, InboundMessage } from '../types.ts';
/** 卡片按钮文案上限：卡片底部按钮排成一行，过长会把整张卡片撑变形 */
export declare const BUTTON_LABEL_MAX = 10;
/** 截断按钮文案，超长补省略号（正文保留完整文本，按钮只是操作入口） */
export declare function buttonLabel(text: string | undefined): string;
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
 * 上游返回 JSON 字符串（QQ 的 button_data 只能放字符串）；推推的 value 允许直接放对象，
 * 因此这里返回对象本身——少一次序列化/转义，也让 SDK 侧不需要再 parse。
 * 显式重建而不是展开原对象：避免调用方多塞的字段（如调试信息）进到用户可点击的载荷里。
 */
export declare function encodeButtonData(data: ButtonData): ButtonData;
/**
 * 解码按钮 value；非法载荷或缺少合法 `t` 时返回 undefined。
 *
 * 同时接受对象与 JSON 字符串：SDK 的 value 类型是 `string | Record`，若中转链路
 * 把它序列化成字符串，语义不应丢失。字段做类型校验（而非上游的直接断言）——推推卡片
 * 的 value 是开放结构，弱校验会把别的卡片载荷误判成本通道的点击。
 */
export declare function decodeButtonData(raw: unknown): ButtonData | undefined;
/** 卡片头部配色（来自 config.interactive，缺省用推推品牌蓝） */
export interface CardTheme {
    headBgColor: string;
    headTextColor: string;
}
export declare const DEFAULT_CARD_THEME: CardTheme;
/** 把配置里的配色投影成主题；未配置的字段回落到默认值 */
export declare function resolveCardTheme(theme?: Partial<CardTheme>): CardTheme;
/**
 * 交互卡片点击的归一化视图（对应上游 QQ 的 `InteractionEvent`）。
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
export declare function getInteractiveAction(message: InboundMessage): InteractiveActionEvent | undefined;
/**
 * 构建单行按钮：推推的 action 是一维数组（没有 QQ 那种 rows/columns 概念），
 * name 是稳定的按钮标识（重放回调时可核对），text 是用户看到的文案。
 */
export declare function buildAction(options: {
    name: string;
    text: string;
    value: ButtonData;
}): TuituiInteractiveAction;
//# sourceMappingURL=button-utils.d.ts.map
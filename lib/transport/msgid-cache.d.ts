/**
 * 最近入站 msgId 缓存 — 记录每个 peer 最近收到的消息 id，供"无上下文的出站发送"
 * 拿到引用回复目标。
 *
 * 用途是两件事：`referenceMessageId` 的引用回复，以及卡片原地编辑时找回目标消息。
 * TTL 只用来避免引用太久以前的消息，不代表任何平台窗口。
 *
 * 按类型区分：普通消息 msgId 与交互卡片回调 eventId，避免用字符串前缀做隐式
 * 类型判别。
 */
import type { ChatScope } from '../types.ts';
/** 引用目标类型 */
export type ReplyIdKind = 'msg' | 'event';
/** 缓存的引用目标 */
export interface CachedReplyId {
    kind: ReplyIdKind;
    /** msg: 消息 id；event: 交互回调事件 id */
    id: string;
}
/** 记录普通消息 msgId */
export declare function cacheMsgId(scope: ChatScope, targetId: string | undefined, msgId: string | undefined): void;
/** 记录交互回调 eventId（内部拼前缀，便于与 msgId 区分展示） */
export declare function cacheEventId(scope: ChatScope, targetId: string | undefined, eventId: string | undefined): void;
/** 获取所有未过期的引用目标（按时间倒序，最新在前） */
export declare function getCachedReplyIds(scope: ChatScope, targetId: string): CachedReplyId[];
/**
 * 取最近一条未过期的**普通消息** id（引用回复用）。
 *
 * 交互回调的 eventId 不是可引用的消息，故跳过；没有候选时返回 undefined，
 * 调用方据此退化为"不引用、直接发送"。
 */
export declare function getMsgId(scope: ChatScope, targetId: string): string | undefined;
//# sourceMappingURL=msgid-cache.d.ts.map
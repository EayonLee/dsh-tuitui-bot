/**
 * 出站回复目标解析与发送 — 推推 ToTarget 解析 + 引用 msgid 兜底
 *
 * 从 gateway 层抽离，保持 bootstrap 只做组装。
 *
 * 引用目标解析是两级兜底：
 *   1. 优先显式 target.msgId（且确认还在缓存窗口内，避免引用一条早已不可见的消息）；
 *   2. 否则取该 peer 最近一条入站 msgId 作为引用；都没有就不引用，直接发送。
 * 帖子作用域走 teams：回复挂在 parentPostId 上，不引用 msgid。
 *
 * ToTarget 用结构化本地类型声明（只依赖形状，不 import SDK）：transport 层
 * 始终只认 TuituiSender 抽象 + 这份形状契约，SDK 类型转换留在 tuitui/。
 */
import type { ReplyTarget, SendResult, TuituiSender } from '../types.ts';
import type { ReplyLimiter } from './reply-limiter.ts';
/**
 * 推推 SDK ToTarget 的结构等价类型（accounts / uids / groupId 三选一）。
 *
 * 与 @qihoo/tuitui-bot-sdk 的 ToTarget 形状完全一致，structural typing 下可直接
 * 传给 client.im.*；这样 transport 不必 import SDK 类型（运行时零耦合）。
 */
export interface TuituiToTarget {
    readonly accounts?: readonly string[];
    readonly uids?: readonly string[];
    readonly groupId?: string;
}
/** 只依赖 sendMarkdown 的发送器形状（TuituiSender 满足） */
export interface MarkdownSenderLike {
    sendMarkdown(target: ReplyTarget, content: string, opts?: {
        keyboard?: unknown;
        at?: string[];
    }): Promise<SendResult>;
}
export interface ResolveReplyTargetOptions {
    /**
     * 是否允许引用最近入站 msgId（默认 true）。
     *
     * 文件/卡片发送不需要引用（引用会让客户端把附件折叠进引用气泡），传 false。
     */
    allowReference?: boolean;
    /** 出站节流守卫（可选）：解析结果仍需排队发送时用它 */
    limiter?: ReplyLimiter;
}
/** 帖子目标是否完整（缺 teamId/channelId 无法发帖） */
export declare function isPostTarget(target: ReplyTarget): boolean;
/**
 * ReplyTarget → 推推 ToTarget。
 *
 * 单聊优先域账号（SDK 的 account 目标支持 modifyText/recall），纯数字才按 uid 处理；
 * 帖子没有 im 目标，返回 null 由调用方改走 teams。
 */
export declare function resolveToTarget(target: ReplyTarget): TuituiToTarget | null;
/**
 * 解析出站目标。
 *
 * 显式 msgId 必须在缓存窗口内才优先使用：延迟投递（交付物、队列积压）携带的旧
 * id 一旦过期，引用回复会退化成"引用不存在的消息"或被平台拒绝。
 */
export declare function resolveReplyTarget(target: ReplyTarget, opts?: ResolveReplyTargetOptions): ReplyTarget;
/**
 * 发送 markdown：解析引用目标（可选节流）后交给发送器。
 *
 * 推推统一走 sendText + referenceMessageId（帖子走 sendPost），因此只保留
 * "解析 + 发送"两步。
 * 命中节流排队时返回空结果（没有 msgId），调用方无需特殊处理。
 */
export declare function sendResolvedMarkdown(bot: MarkdownSenderLike | TuituiSender, target: ReplyTarget, content: string, opts?: {
    keyboard?: unknown;
    at?: string[];
}): Promise<SendResult>;
/**
 * 带节流的 markdown 发送（bootstrap 的发送器适配器用）。
 *
 * 把节流放在这一个发送入口，而不是散落在每个调用点：流式降级、工具结果、
 * 交付物清单最终都会经过这里，顺序与间隔由 ReplyLimiter 统一保证。
 */
export declare function sendThrottledMarkdown(bot: MarkdownSenderLike | TuituiSender, target: ReplyTarget, content: string, opts: {
    keyboard?: unknown;
    at?: string[];
} | undefined, limiter: ReplyLimiter): Promise<SendResult>;
//# sourceMappingURL=reply-target.d.ts.map
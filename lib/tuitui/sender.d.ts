/**
 * 推推出站发送器 — TuituiSender 的 SDK 实现
 *
 * 全插件唯一的"真正发消息"的地方：
 * - 单聊/群聊：client.im（文本 / 交互卡片 / 文件 / 编辑 / 撤回 / emoji）
 * - 团队帖子：client.teams（发帖 / 编辑帖 / 文件 / emoji）
 * 流式走"首条发送拿 msgid + modifyText 原地编辑"。
 */
import type { ToTarget, TuituiBotClient, TuituiOutboundInteractiveMessage } from '@qihoo/tuitui-bot-sdk';
import type { Logger, MediaSource, ReplyTarget, SendResult, StreamSessionLike, TuituiSender } from '../types.ts';
import { type RetryPolicy } from './retry-policy.ts';
import { SendQueue } from './send-queue.ts';
/** 发送队列的分组键：同一会话串行，不同会话并行 */
export declare function sendQueueKey(target: ReplyTarget): string;
/** 发送器构造参数 */
export interface TuituiSenderOptions {
    client: TuituiBotClient;
    logger: Logger;
    /** 是否启用流式（群聊/帖子由调用方另行决定） */
    streaming: boolean;
    /** 流式刷新节流(ms) */
    streamIntervalMs: number;
    /** 重试策略（默认 6 次、指数退避 + 抖动、总预算 75s） */
    retryPolicy?: RetryPolicy;
    /** 单会话串行发送队列（默认按会话串行、每会话最多积压 20 条） */
    sendQueue?: SendQueue;
    /** 单条文本上限（超出时由调用方切分，这里只做兜底断言） */
    textChunkLimit: number;
}
/**
 * ReplyTarget → SDK ToTarget。
 *
 * c2c 优先用域账号（SDK 的 account 目标支持编辑/撤回；uid 目标不支持），
 * 没有域账号才退化到 uid——此时 openStream 会返回 null，走静态发送。
 */
export declare function toSdkTarget(target: ReplyTarget): ToTarget | null;
/** 交互卡片的纯文本兜底渲染（帖子/卡片不可用时的降级） */
export declare function renderCardAsText(card: TuituiOutboundInteractiveMessage): string;
export declare class TuituiSenderImpl implements TuituiSender {
    private readonly client;
    private readonly logger;
    private readonly streaming;
    private readonly streamIntervalMs;
    private readonly retryPolicy;
    private readonly queue;
    constructor(options: TuituiSenderOptions);
    /** 统一失败日志（推推错误必须完整记录，含 trans_id） */
    private warnFailure;
    /**
     * 发一条文本（里面可以是 markdown）。
     *
     * 两层保护：
     * 1. 按会话串行（SendQueue）：同一会话的消息按顺序发，重试不会把后一条挤到前面去
     * 2. 单条发送带退避重试（withSendRetry）：10503 / 5xx / 网络错误自动重来
     */
    sendMarkdown(target: ReplyTarget, content: string, opts?: {
        keyboard?: unknown;
        at?: string[];
    }): Promise<SendResult>;
    /** 真正调 SDK 的那一层（带重试），队列里一次只跑一条 */
    private sendOnce;
    /** 统一的重试入口：日志挂在 onRetry 上，方便以后排查"重了几下才好" */
    private retry;
    openStream(target: ReplyTarget): StreamSessionLike | null;
    /** 首条发送（流式会话内部使用）：拿到 msgid 才能原地编辑 */
    sendStreamSeed(target: ReplyTarget, content: string): Promise<string | undefined>;
    /** 原地编辑（流式会话内部使用） */
    editStream(target: ReplyTarget, msgId: string, content: string, withoutPush: boolean): Promise<void>;
    sendInteractive(target: ReplyTarget, card: unknown): Promise<SendResult>;
    modifyInteractive(target: ReplyTarget, msgId: string, card: unknown): Promise<void>;
    sendImage(target: ReplyTarget, source: MediaSource, opts?: {
        caption?: string;
        filename?: string;
    }): Promise<SendResult>;
    sendFile(target: ReplyTarget, source: MediaSource, opts?: {
        filename?: string;
        caption?: string;
    }): Promise<SendResult>;
    /**
     * 统一媒体发送。
     *
     * 推推没有独立的图片/视频/语音接口：im.sendFile 会按文件内容判定
     * image / attachment，图文说明用"先发说明文本、再发文件"两步（帖子用
     * teams.sendFile 自带 text 字段）。
     */
    private sendMedia;
    recall(target: ReplyTarget, msgId: string): Promise<void>;
    emojiReaction(target: ReplyTarget, msgId: string, emoji: string, cancel?: boolean): Promise<void>;
}
//# sourceMappingURL=sender.d.ts.map
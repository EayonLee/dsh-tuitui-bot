/**
 * 推推出站发送器 — TuituiSender 的 SDK 实现
 *
 * 全插件唯一的"真正发消息"的地方：
 * - 单聊/群聊：client.im（文本 / 交互卡片 / 文件 / 编辑 / 撤回 / emoji）
 * - 团队帖子：client.teams（发帖 / 编辑帖 / 文件 / emoji）
 * 上游 QQ 的"被动回复 + openStream"在这里变成"首条发送拿 msgid + modifyText 原地编辑"。
 */
import type { ToTarget, TuituiBotClient, TuituiOutboundInteractiveMessage } from '@qihoo/tuitui-bot-sdk';
import type { Logger, MediaSource, ReplyTarget, SendResult, StreamSessionLike, TuituiSender } from '../types.ts';
/** 发送器构造参数 */
export interface TuituiSenderOptions {
    client: TuituiBotClient;
    logger: Logger;
    /** 是否启用流式（群聊/帖子由调用方另行决定） */
    streaming: boolean;
    /** 流式刷新节流(ms) */
    streamIntervalMs: number;
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
    constructor(options: TuituiSenderOptions);
    /** 统一失败日志（推推错误必须完整记录，含 trans_id） */
    private warnFailure;
    sendMarkdown(target: ReplyTarget, content: string, opts?: {
        keyboard?: unknown;
        at?: string[];
    }): Promise<SendResult>;
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
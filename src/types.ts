/**
 * dsh-tuitui-bot 插件内部类型定义
 *
 * 公共契约（Lead 维护）：各工作流只依赖本文件的类型，不要私自扩展。
 */

/** 会话作用域：c2c=单聊，group=群聊，post=团队频道帖子 */
export type ChatScope = 'c2c' | 'group' | 'post';

/**
 * 推推出站目标。
 *
 * - c2c：targetId = 对方域账号（无域账号时退化为 uid）
 * - group：targetId = group_id
 * - post：targetId = channel_id，配合 teamId/postId/parentPostId 使用
 */
export interface ReplyTarget {
  scope: ChatScope;
  targetId: string;
  /** 最近入站消息 id（引用回复 / 原地编辑） */
  msgId?: string;
  /** interactive_action 事件标识（无 msgid 时兜底，用于卡片原地更新） */
  eventId?: string;
  /** post 专用：团队 id */
  teamId?: string;
  /** post 专用：频道 id（与 targetId 一致，便于分发） */
  channelId?: string;
  /** post 专用：帖子 id */
  postId?: string;
  /** post 专用：被回复的帖子 id（回复楼层） */
  parentPostId?: string;
  /** 群聊 @ 目标（域账号或姓名） */
  at?: string[];
}

/** 入站附件（推推原始媒体 → 归一化视图） */
export interface InboundAttachment {
  kind: 'image' | 'file' | 'voice' | 'video';
  filename?: string;
  url?: string;
  mimeType?: string;
  size?: number;
  fileId?: string;
  /** 语音转写文本（推推如有提供） */
  asrText?: string;
  width?: number;
  height?: number;
}

/** 引用消息（推推 data.ref） */
export interface InboundReference {
  text?: string;
  senderName?: string;
  senderAccount?: string;
  attachments?: InboundAttachment[];
  /** 原始共享帖子 id（shared_post） */
  sharedPostId?: string;
}

/** 团队帖子定位 */
export interface InboundPostRef {
  teamId: string;
  channelId: string;
  postId: string;
  parentId?: string;
  teamName?: string;
  channelName?: string;
  isReply: boolean;
}

/** 归一化后的入站消息（推推事件 → 内部统一形态） */
export interface InboundMessage {
  /** 推推事件名：single_chat / group_chat / teams_post_create / interactive_action */
  eventType: string;
  kind: ChatScope;
  /** 发送者 uid */
  senderId: string;
  /** 发送者域账号 */
  senderAccount: string;
  senderName: string;
  /** 正文（清洗后的用户输入） */
  content: string;
  /** msgid / post_id / 交互事件 id */
  messageId: string;
  timestamp: string;
  groupId?: string;
  groupName?: string;
  /** 群聊/帖子是否 @ 了自己 */
  atMe?: boolean;
  at?: Array<{ isAtAll: boolean; account?: string; uid?: string; name?: string }>;
  reference?: InboundReference;
  attachments: InboundAttachment[];
  post?: InboundPostRef;
  /** 发送者本身是机器人（回声过滤用） */
  fromBot?: boolean;
  /** 原始事件体（调试/兜底） */
  raw: unknown;
}

/** 已下载到本地的媒体文件 */
export interface DownloadedFile {
  filename: string;
  localPath?: string;
  bytes?: number;
  kind: 'image' | 'file' | 'voice' | 'video';
  error?: string;
}

/** 附件处理中间件产物 */
export interface ProcessedAttachment {
  type: 'voice' | 'image' | 'video' | 'file' | 'unknown';
  filename?: string;
  url?: string;
  localPath?: string;
  voiceText?: string;
  voiceSource?: 'stt' | 'asr' | 'fallback';
  duration?: number;
  width?: number;
  height?: number;
  size?: number;
}

/** 群历史缓冲条目 */
export interface HistoryEntry {
  senderId: string;
  senderName?: string;
  content: string;
  timestamp: number;
  messageId: string;
}

/** 中间件共享状态 */
export interface MiddlewareState {
  quote?: { text?: string; senderName?: string; attachments?: InboundAttachment[] };
  history?: HistoryEntry[];
  envelope?: string;
  mention?: { wasMentioned?: boolean };
  processedAttachments?: ProcessedAttachment[];
  downloadedFiles?: DownloadedFile[];
  downloadedQuoteFiles?: DownloadedFile[];
  /** 该消息已被待答问题中间件消费 */
  answeredQuestion?: boolean;
  [key: string]: unknown;
}

/** 中间件上下文 */
export interface MiddlewareContext {
  message: InboundMessage;
  state: MiddlewareState;
  replyTarget: ReplyTarget;
  bot: TuituiSender;
  /** 中断后续中间件与入站处理（门控命中、命令已消费、重复消息等） */
  skip(reason: string): void;
  readonly skipped: string | undefined;
}

/** 洋葱中间件 */
export type Middleware = (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void>;

/** 出站发送结果 */
export interface SendResult {
  msgId?: string;
}

/** 流式会话（modifyText 原地编辑） */
export interface StreamSessionLike {
  update(content: string): Promise<void>;
  complete(): Promise<void>;
}

/** 媒体来源：本地路径 / http(s) URL / 内存字节 */
export type MediaSource =
  | string
  | { data: Uint8Array | ArrayBuffer; filename: string; contentType?: string };

/**
 * 推推出站原语（文本 / 流式 / 卡片 / 媒体 / 撤回 / 回应合一）。
 *
 * transport / commands / features / media 全部通过本接口发消息，
 * 不直接触碰 @qihoo/tuitui-bot-sdk。
 */
export interface TuituiSender {
  sendMarkdown(
    target: ReplyTarget,
    content: string,
    opts?: { keyboard?: unknown; at?: string[] },
  ): Promise<SendResult>;
  /** 开流式会话；拿不到 msgid（如帖子）时返回 null，调用方降级为静态发送 */
  openStream(target: ReplyTarget): StreamSessionLike | null;
  sendInteractive(target: ReplyTarget, card: unknown): Promise<SendResult>;
  modifyInteractive(target: ReplyTarget, msgId: string, card: unknown): Promise<void>;
  sendImage(
    target: ReplyTarget,
    source: MediaSource,
    opts?: { caption?: string; filename?: string },
  ): Promise<SendResult>;
  sendFile(
    target: ReplyTarget,
    source: MediaSource,
    opts?: { filename?: string; caption?: string },
  ): Promise<SendResult>;
  recall(target: ReplyTarget, msgId: string): Promise<void>;
  emojiReaction(target: ReplyTarget, msgId: string, emoji: string, cancel?: boolean): Promise<void>;
}

/** 插件 Logger 接口 */
export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

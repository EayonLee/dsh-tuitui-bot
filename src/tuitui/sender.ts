/**
 * 推推出站发送器 — TuituiSender 的 SDK 实现
 *
 * 全插件唯一的"真正发消息"的地方：
 * - 单聊/群聊：client.im（文本 / 交互卡片 / 文件 / 编辑 / 撤回 / emoji）
 * - 团队帖子：client.teams（发帖 / 编辑帖 / 文件 / emoji）
 * 上游 QQ 的"被动回复 + openStream"在这里变成"首条发送拿 msgid + modifyText 原地编辑"。
 */
import type { ToTarget, TuituiBotClient, TuituiOutboundInteractiveMessage } from '@qihoo/tuitui-bot-sdk';
import type {
  Logger,
  MediaSource,
  ReplyTarget,
  SendResult,
  StreamSessionLike,
  TuituiSender,
} from '../types.ts';
import { extractMessageId, describeApiError } from './client.ts';

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
export function toSdkTarget(target: ReplyTarget): ToTarget | null {
  if (target.scope === 'group') {
    return { groupId: target.targetId };
  }
  if (target.scope === 'c2c') {
    const account = target.targetId;
    if (/^\d+$/.test(account)) return { uids: [account] };
    return { accounts: [account] };
  }
  // post 作用域没有 im 目标，必须走 teams
  return null;
}

/** 帖子目标是否完整 */
function isPostTarget(target: ReplyTarget): boolean {
  return (
    target.scope === 'post' &&
    typeof target.teamId === 'string' &&
    target.teamId.length > 0 &&
    typeof target.channelId === 'string' &&
    target.channelId.length > 0
  );
}

/** 把媒体来源归一化为 SDK 可上传的形态 */
function normalizeMediaSource(source: MediaSource): string | {
  data: Uint8Array;
  filename: string;
  contentType?: string;
} {
  if (typeof source === 'string') return source;
  const bytes = source.data instanceof Uint8Array ? source.data : new Uint8Array(source.data);
  return {
    data: bytes,
    filename: source.filename,
    ...(source.contentType ? { contentType: source.contentType } : {}),
  };
}

/** 交互卡片的纯文本兜底渲染（帖子/卡片不可用时的降级） */
export function renderCardAsText(card: TuituiOutboundInteractiveMessage): string {
  const lines: string[] = [];
  if (card.head?.text) lines.push(`**${card.head.text}**`);
  if (card.body?.title) lines.push(`**${card.body.title}**`);
  if (card.body?.content) lines.push(card.body.content);
  for (const field of card.fields ?? []) {
    if (field.text) lines.push(field.text);
    else if (field.name && typeof field.value === 'string') lines.push(`${field.name}：${field.value}`);
  }
  for (const footer of card.footer ?? []) {
    if (footer.text) lines.push(footer.text);
  }
  const actions = (card.action ?? []).filter((action) => action.text);
  if (actions.length > 0) {
    lines.push('', actions.map((action, index) => `${index + 1}. ${action.text}`).join('\n'));
  }
  return lines.join('\n');
}

export class TuituiSenderImpl implements TuituiSender {
  private readonly client: TuituiBotClient;
  private readonly logger: Logger;
  private readonly streaming: boolean;
  private readonly streamIntervalMs: number;

  public constructor(options: TuituiSenderOptions) {
    this.client = options.client;
    this.logger = options.logger;
    this.streaming = options.streaming;
    this.streamIntervalMs = options.streamIntervalMs;
  }

  /** 统一失败日志（推推错误必须完整记录，含 trans_id） */
  private warnFailure(action: string, target: ReplyTarget, error: unknown): void {
    this.logger.warn(`${action} failed (scope=${target.scope} target=${target.targetId}): ${describeApiError(error)}`);
  }

  public async sendMarkdown(
    target: ReplyTarget,
    content: string,
    opts?: { keyboard?: unknown; at?: string[] },
  ): Promise<SendResult> {
    if (!content.trim()) return {};
    try {
      if (target.scope === 'post') {
        if (!isPostTarget(target)) throw new Error('post target requires teamId/channelId');
        const response = await this.client.teams.sendPost({
          teamId: target.teamId as string,
          channelId: target.channelId as string,
          text: content,
          ...(target.parentPostId ? { parentId: target.parentPostId } : {}),
        });
        return { msgId: extractMessageId(response) };
      }
      const to = toSdkTarget(target);
      if (!to) throw new Error(`unsupported target scope: ${target.scope}`);
      const response = await this.client.im.sendText({
        to,
        text: content,
        ...(target.msgId ? { referenceMessageId: target.msgId } : {}),
        ...(opts?.at && opts.at.length > 0 ? { at: opts.at } : {}),
      });
      return { msgId: extractMessageId(response) };
    } catch (error) {
      this.warnFailure('sendMarkdown', target, error);
      throw error;
    }
  }

  public openStream(target: ReplyTarget): StreamSessionLike | null {
    if (!this.streaming) return null;
    if (target.scope === 'c2c' && /^\d+$/.test(target.targetId)) {
      // uid 目标不支持 modifyText，降级静态发送
      return null;
    }
    if (target.scope === 'post' && !isPostTarget(target)) return null;
    return new TuituiStreamSession(this, target, this.streamIntervalMs);
  }

  /** 首条发送（流式会话内部使用）：拿到 msgid 才能原地编辑 */
  public async sendStreamSeed(target: ReplyTarget, content: string): Promise<string | undefined> {
    const result = await this.sendMarkdown(target, content);
    return result.msgId;
  }

  /** 原地编辑（流式会话内部使用） */
  public async editStream(target: ReplyTarget, msgId: string, content: string, withoutPush: boolean): Promise<void> {
    if (!content.trim()) return;
    try {
      if (target.scope === 'post') {
        await this.client.teams.editPost({
          teamId: target.teamId as string,
          channelId: target.channelId as string,
          postId: msgId,
          text: content,
        });
        return;
      }
      const to = toSdkTarget(target);
      if (!to) throw new Error(`unsupported target scope: ${target.scope}`);
      await this.client.im.modifyText({ to, messageId: msgId, text: content, withoutPush });
    } catch (error) {
      this.warnFailure('modifyText', target, error);
      throw error;
    }
  }

  public async sendInteractive(target: ReplyTarget, card: unknown): Promise<SendResult> {
    const interactive = card as TuituiOutboundInteractiveMessage;
    if (target.scope === 'post') {
      // 帖子不支持交互卡片，降级为文本（保留编号选项语义，由 answer-parser 处理）
      return this.sendMarkdown(target, renderCardAsText(interactive));
    }
    try {
      const to = toSdkTarget(target);
      if (!to) throw new Error(`unsupported target scope: ${target.scope}`);
      const response = await this.client.im.sendInteractive({ to, interactive });
      return { msgId: extractMessageId(response) };
    } catch (error) {
      this.warnFailure('sendInteractive', target, error);
      throw error;
    }
  }

  public async modifyInteractive(target: ReplyTarget, msgId: string, card: unknown): Promise<void> {
    const interactive = card as TuituiOutboundInteractiveMessage;
    try {
      if (target.scope === 'post') {
        await this.client.teams.editPost({
          teamId: target.teamId as string,
          channelId: target.channelId as string,
          postId: msgId,
          text: renderCardAsText(interactive),
        });
        return;
      }
      const to = toSdkTarget(target);
      if (!to) throw new Error(`unsupported target scope: ${target.scope}`);
      await this.client.im.modifyInteractive({ to, messageId: msgId, interactive });
    } catch (error) {
      this.warnFailure('modifyInteractive', target, error);
      throw error;
    }
  }

  public async sendImage(
    target: ReplyTarget,
    source: MediaSource,
    opts?: { caption?: string; filename?: string },
  ): Promise<SendResult> {
    return this.sendMedia(target, source, { ...opts, kind: 'image' });
  }

  public async sendFile(
    target: ReplyTarget,
    source: MediaSource,
    opts?: { filename?: string; caption?: string },
  ): Promise<SendResult> {
    return this.sendMedia(target, source, { ...opts, kind: 'file' });
  }

  /**
   * 统一媒体发送。
   *
   * 推推没有独立的图片/视频/语音接口：im.sendFile 会按文件内容判定
   * image / attachment，图文说明用"先发说明文本、再发文件"两步（帖子用
   * teams.sendFile 自带 text 字段）。
   */
  private async sendMedia(
    target: ReplyTarget,
    source: MediaSource,
    opts: { caption?: string; filename?: string; kind: 'image' | 'file' },
  ): Promise<SendResult> {
    const prepared = normalizeMediaSource(source);
    try {
      if (target.scope === 'post') {
        if (!isPostTarget(target)) throw new Error('post target requires teamId/channelId');
        const response = await this.client.teams.sendFile({
          teamId: target.teamId as string,
          channelId: target.channelId as string,
          source: prepared,
          ...(opts.caption ? { text: opts.caption } : {}),
          ...(target.parentPostId ? { parentId: target.parentPostId } : {}),
        });
        return { msgId: extractMessageId(response) };
      }
      const to = toSdkTarget(target);
      if (!to) throw new Error(`unsupported target scope: ${target.scope}`);
      if (opts.caption) {
        await this.client.im.sendText({ to, text: opts.caption });
      }
      const response = await this.client.im.sendFile({
        to,
        source: prepared,
        ...(opts.filename ? { filename: opts.filename } : {}),
      });
      return { msgId: extractMessageId(response) };
    } catch (error) {
      this.warnFailure(`sendMedia(${opts.kind})`, target, error);
      throw error;
    }
  }

  public async recall(target: ReplyTarget, msgId: string): Promise<void> {
    if (target.scope === 'post') {
      // 团队帖子无撤回 API，静默跳过（上游 QQ 有 recall，这里记录一次 warn 便于观测）
      this.logger.debug?.(`recall unsupported for post target (postId=${msgId})`);
      return;
    }
    try {
      const to = toSdkTarget(target);
      if (!to) return;
      await this.client.im.recall({ to, messageId: msgId });
    } catch (error) {
      this.warnFailure('recall', target, error);
      throw error;
    }
  }

  public async emojiReaction(target: ReplyTarget, msgId: string, emoji: string, cancel?: boolean): Promise<void> {
    try {
      if (target.scope === 'post') {
        await this.client.teams.emojiReaction({
          teamId: target.teamId as string,
          channelId: target.channelId as string,
          postId: msgId,
          emoji,
          ...(cancel ? { cancel } : {}),
        });
        return;
      }
      const to = toSdkTarget(target);
      if (!to) return;
      await this.client.im.emojiReaction({ to, messageId: msgId, emoji, ...(cancel ? { cancel } : {}) });
    } catch (error) {
      // emoji reaction 属锦上添花，失败不打扰用户
      this.logger.debug?.(`emojiReaction failed: ${describeApiError(error)}`);
    }
  }
}

/**
 * 流式会话：首帧发送拿 msgid，后续帧 modifyText(without_push) 原地刷新。
 *
 * 与上游 QQ openStream 的差异：QQ 是"针对入站消息开流"（天然有 msg_id），
 * 推推必须先发一条真实消息才有 msgid，因此首帧承担"建消息"的职责；
 * 拿不到 msgid（uid 目标/帖子返回缺失）时退化为每帧追加发送，保证不丢内容。
 */
class TuituiStreamSession implements StreamSessionLike {
  private readonly owner: TuituiSenderImpl;
  private readonly target: ReplyTarget;
  private readonly throttleMs: number;
  private msgId: string | undefined;
  private pending = '';
  private lastFlushAt = 0;
  private flushing: Promise<void> | null = null;
  private closed = false;

  public constructor(owner: TuituiSenderImpl, target: ReplyTarget, throttleMs: number) {
    this.owner = owner;
    this.target = target;
    this.throttleMs = Math.max(0, throttleMs);
  }

  public async update(content: string): Promise<void> {
    if (this.closed) return;
    this.pending = content;
    const now = Date.now();
    if (this.msgId === undefined) {
      // 首帧立即发送（用户等待感知最关键）
      this.msgId = await this.owner.sendStreamSeed(this.target, content);
      this.lastFlushAt = now;
      return;
    }
    if (now - this.lastFlushAt < this.throttleMs) {
      // 节流窗口内：留给 complete() 或下一个窗口统一刷新
      return;
    }
    await this.flush();
  }

  public async complete(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.msgId === undefined) {
      if (this.pending) await this.owner.sendStreamSeed(this.target, this.pending);
      return;
    }
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.flushing) {
      await this.flushing;
      return;
    }
    const content = this.pending;
    const msgId = this.msgId;
    if (!msgId || !content) return;
    this.lastFlushAt = Date.now();
    this.flushing = this.owner
      .editStream(this.target, msgId, content, true)
      .catch(() => undefined)
      .then(() => {
        this.flushing = null;
      });
    await this.flushing;
  }
}

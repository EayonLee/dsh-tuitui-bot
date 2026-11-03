/**
 * 推推事件归一化 — TuituiEventBody → InboundMessage
 *
 * 推推 SDK 只提供事件体与文本渲染，不产出中间件上下文，因此这里集中做一次
 * 映射：TuituiEventBody → InboundMessage，后续中间件/传输层只认 InboundMessage。
 *
 * 支持的事件：
 * - single_chat       单聊消息
 * - group_chat        群聊消息（带 at_me / at[]）
 * - teams_post_create 团队频道帖子（含回帖）
 * - interactive_action 交互卡片点击回调（审批/问答按钮）
 * 其它事件（建群、成员变更、频道变更等）返回 null，由 gateway 决定是否记日志。
 */
import type {
  TuituiEventBody,
  TuituiEventMessage,
  TuituiEventTeamsPost,
  TuituiInteractiveCallbackMessage,
  TuituiMessageData,
  TuituiTeamsPostData,
} from '@qihoo/tuitui-bot-sdk';
import type { InboundAttachment, InboundMessage, InboundPostRef, InboundReference } from '../types.ts';

/** 渲染消息正文的注入点（来自 client.event.renderMessageBody，避免在纯函数里持有客户端） */
export type MessageRenderer = (data: unknown) => string;

export interface NormalizeOptions {
  render: MessageRenderer;
}

/**
 * SDK 在事件体里为每个媒体补一个 `_tuitui_media` 影子字段（{mimeType,url,name,fileId}[]），
 * 与原始 images/voice/video/file 并存。这里按"影子字段优先、原始字段兜底"合并去重，
 * 避免同一张图出现两次。
 */
const MEDIA_SHADOW_KEY = '_tuitui_media';

/** 归一化入口：不认识的推推事件返回 null */
export function normalizeEvent(body: TuituiEventBody, options: NormalizeOptions): InboundMessage | null {
  const event = typeof body.event === 'string' ? body.event : '';
  switch (event) {
    case 'single_chat':
    case 'group_chat':
      return normalizeMessage(body as TuituiEventMessage, options);
    case 'teams_post_create':
      return normalizePost(body as TuituiEventTeamsPost);
    case 'interactive_action':
      return normalizeInteractive(body);
    default:
      return null;
  }
}

/** 事件名是否属于"消息类"（用于 gateway 的忽略日志降噪） */
export function isMessageEvent(event: string): boolean {
  return event === 'single_chat' || event === 'group_chat' || event === 'teams_post_create';
}

function normalizeMessage(body: TuituiEventMessage, options: NormalizeOptions): InboundMessage {
  const data: TuituiMessageData = (body.data ?? {}) as TuituiMessageData;
  const kind = body.event === 'group_chat' ? 'group' : 'c2c';
  // 用 firstString 而不是 ??: 推推可能给空串，空串既不回落事件体、又会把 groupId 丢掉
  const groupId = firstString(data.group_id, body.group_id);
  const messageId = firstString(data.msgid, body.cid) ?? `${body.event}:${body.timestamp ?? ''}`;
  const groupName = firstString(data.group_name, body.group_name);

  return {
    eventType: body.event,
    kind,
    senderId: body.uid ?? '',
    senderAccount: body.user_account ?? '',
    senderName: body.user_name ?? '',
    content: renderContent(data, options),
    messageId,
    timestamp: body.timestamp ?? '',
    ...(groupId ? { groupId } : {}),
    ...(groupName ? { groupName } : {}),
    ...(typeof data.at_me === 'boolean' ? { atMe: data.at_me } : {}),
    ...normalizeAt(data),
    ...normalizeReference(data, options),
    attachments: normalizeAttachments(data),
    ...(body.user_is_bot === true ? { fromBot: true } : {}),
    raw: body,
  };
}

function normalizePost(body: TuituiEventTeamsPost): InboundMessage {
  const data: TuituiTeamsPostData = (body.data ?? {}) as TuituiTeamsPostData;
  const post: InboundPostRef = {
    teamId: data.team_id ?? '',
    channelId: data.channel_id ?? '',
    postId: data.post_id ?? '',
    ...(data.parent_id ? { parentId: data.parent_id } : {}),
    ...(data.team_name ? { teamName: data.team_name } : {}),
    ...(data.channel_name ? { channelName: data.channel_name } : {}),
    isReply: data.is_reply === true,
  };

  // 帖子的正文优先用 content，富文本类型（markdown）时 content 已是渲染结果；
  // rich_text 是原始序列化串，仅在 content 缺失时兜底。
  const content = firstString(data.content, data.rich_text) ?? '';

  return {
    eventType: body.event,
    kind: 'post',
    senderId: body.uid ?? '',
    senderAccount: body.user_account ?? '',
    senderName: body.user_name ?? '',
    content,
    messageId: post.postId || firstString(body.cid) || `post:${body.timestamp ?? ''}`,
    timestamp: body.timestamp ?? '',
    ...(typeof data.at_me === 'boolean' ? { atMe: data.at_me } : {}),
    ...normalizePostAt(data),
    attachments: normalizePostAttachments(data),
    post,
    ...(body.user_is_bot === true ? { fromBot: true } : {}),
    raw: body,
  };
}

/**
 * 交互卡片回调。
 *
 * 推推把点击事件推成 interactive_action，button value 携带我们的
 * `{t:'approval'|'question'}` 协议；审批/问答通道从 raw 里取原始回调结构，
 * content 仅用于日志与文本兜底解析。
 */
function normalizeInteractive(body: TuituiEventBody): InboundMessage {
  const data = (body.data ?? {}) as TuituiInteractiveCallbackMessage & Record<string, unknown>;
  const user = (data.user ?? data.sender ?? {}) as { uid?: string; account?: string; name?: string };
  const messageId = firstString(data.msgid, body.cid) ?? `interactive:${body.timestamp ?? ''}`;
  const actionText = Array.isArray(data.action)
    ? data.action
        .map((item) => firstString(item.text, stringifyValue(item.value)) ?? '')
        .filter(Boolean)
        .join(' ')
    : '';
  const conversationType = typeof data.conversation?.type === 'string' ? data.conversation.type : '';
  const kind: InboundMessage['kind'] = conversationType === 'group' || body.group_id ? 'group' : 'c2c';

  return {
    eventType: 'interactive_action',
    kind,
    senderId: firstString(user.uid, body.uid) ?? '',
    senderAccount: firstString(user.account, body.user_account) ?? '',
    senderName: firstString(user.name, body.user_name) ?? '',
    content: firstString(actionText, body.user_name) ?? '',
    messageId,
    timestamp: body.timestamp ?? '',
    ...(body.group_id ? { groupId: body.group_id } : {}),
    ...(body.group_name ? { groupName: body.group_name } : {}),
    attachments: [],
    ...(body.user_is_bot === true ? { fromBot: true } : {}),
    raw: body,
  };
}

/** 正文：优先 text（SDK 已把共享帖归一化为 text），否则用 SDK 渲染器拼装各消息类型 */
function renderContent(data: TuituiMessageData, options: NormalizeOptions): string {
  const text = typeof data.text === 'string' ? data.text : '';
  if (text.trim()) return text;
  try {
    return options.render(data).trim();
  } catch {
    return '';
  }
}

/** 群 @ 列表（推推 at[]: { is_at_all, cid, uid, name }，域账号在 cid 字段） */
function normalizeAt(data: TuituiMessageData): Pick<InboundMessage, 'at'> {
  const raw = data.at;
  if (!Array.isArray(raw) || raw.length === 0) return {};
  return {
    at: raw.map((item) => ({
      isAtAll: item.is_at_all === true,
      ...(item.cid ? { account: item.cid } : {}),
      ...(item.uid ? { uid: item.uid } : {}),
      ...(item.name ? { name: item.name } : {}),
    })),
  };
}

/** 帖子 @ 列表（结构不同于群聊：{type:'all'|'tag'|'user', user?}） */
function normalizePostAt(data: TuituiTeamsPostData): Pick<InboundMessage, 'at'> {
  const raw = data.at;
  if (!Array.isArray(raw) || raw.length === 0) return {};
  return {
    at: raw.map((item) => ({
      isAtAll: item.type === 'all',
      ...(item.user?.account ? { account: item.user.account } : {}),
      ...(item.user?.uid ? { uid: item.user.uid } : {}),
      ...(item.user?.name ? { name: item.user.name } : {}),
    })),
  };
}

/** 引用消息（data.ref）：文本由 SDK 渲染器兜底，附件按媒体归一化 */
function normalizeReference(
  data: TuituiMessageData,
  options: NormalizeOptions,
): Pick<InboundMessage, 'reference'> {
  const ref = data.ref;
  if (!ref || typeof ref !== 'object') return {};

  let text = typeof ref.text === 'string' ? ref.text.trim() : '';
  if (!text) {
    try {
      text = options.render(ref).trim();
    } catch {
      text = '';
    }
  }

  const reference: InboundReference = {
    ...(text ? { text } : {}),
    ...(ref.user_name ? { senderName: ref.user_name } : {}),
    ...(ref.user_account ? { senderAccount: ref.user_account } : {}),
    attachments: normalizeAttachments(ref as TuituiMessageData),
    ...(ref.shared_post ? { sharedPostId: ref.shared_post } : {}),
  };
  return { reference };
}

/** 从任意字段里取 URL（推推有些字段是字符串，有些是 {url}） */
function mediaUrl(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw.trim() || undefined;
  if (raw && typeof raw === 'object') {
    const url = (raw as Record<string, unknown>).url;
    if (typeof url === 'string' && url.trim()) return url;
  }
  return undefined;
}

/** 媒体字段名（推推原始字段） */
function mediaName(raw: unknown): string | undefined {
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    for (const key of ['name', 'filename'] as const) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return undefined;
}

function mediaFileId(raw: unknown): string | undefined {
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    for (const key of ['file_id', 'fid', 'fileId'] as const) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return undefined;
}

/**
 * 媒体归一化：
 * 1) 先取 `_tuitui_media` 影子字段（SDK 归一化后的 mime 信息，最准）
 * 2) 再用原始 images / voice / video / file 补齐（影子缺失时兜底）
 * 3) 按 url / fileId 去重：影子字段与原始字段常描述同一个文件，
 *    只按其中一个键判重会让同一张图出现两条附件。
 */
function normalizeAttachments(data: TuituiMessageData): InboundAttachment[] {
  const result: InboundAttachment[] = [];
  const seen = new Set<string>();
  const push = (attachment: InboundAttachment): void => {
    const keys = [attachment.fileId, attachment.url, attachment.filename]
      .filter((value): value is string => typeof value === 'string' && value !== '');
    if (keys.length === 0) {
      result.push(attachment);
      return;
    }
    if (keys.some((key) => seen.has(key))) return;
    for (const key of keys) seen.add(key);
    result.push(attachment);
  };

  const shadow = (data as Record<string, unknown>)[MEDIA_SHADOW_KEY];
  if (Array.isArray(shadow)) {
    for (const item of shadow) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const url = mediaUrl(record) ?? mediaUrl(record.url);
      if (!url) continue;
      const mimeType = firstString(
        typeof record.mimeType === 'string' ? record.mimeType : undefined,
        typeof record.mime_type === 'string' ? record.mime_type : undefined,
      );
      push({
        kind: classifyMime(mimeType),
        url,
        mimeType: mimeType ?? 'application/octet-stream',
        ...(mediaName(record) ? { filename: mediaName(record) } : {}),
        ...(mediaFileId(record) ? { fileId: mediaFileId(record) } : {}),
      });
    }
  }

  for (const image of data.images ?? []) {
    const url = mediaUrl(image);
    if (url) push({ kind: 'image', url, mimeType: 'image/*' });
  }
  for (const [key, kind] of [['voice', 'voice'], ['video', 'video']] as const) {
    const raw = (data as Record<string, unknown>)[key];
    const url = mediaUrl(raw);
    if (url) {
      push({
        kind,
        url,
        mimeType: kind === 'voice' ? 'audio/*' : 'video/*',
        ...(mediaName(raw) ? { filename: mediaName(raw) } : {}),
      });
    }
  }
  if (data.file) {
    const url = mediaUrl(data.file);
    if (url) {
      push({
        kind: classifyMime(typeof data.file.mime_type === 'string' ? data.file.mime_type : undefined),
        url,
        ...(mediaName(data.file) ? { filename: mediaName(data.file) } : {}),
        ...(mediaFileId(data.file) ? { fileId: mediaFileId(data.file) } : {}),
        ...(typeof data.file.mime_type === 'string' ? { mimeType: data.file.mime_type } : {}),
      });
    }
  }

  // 语音转写：部分场景推推把 ASR 文本挂在 data.asr_refer_text 上
  const asrText = typeof (data as Record<string, unknown>).asr_refer_text === 'string'
    ? ((data as Record<string, unknown>).asr_refer_text as string)
    : undefined;
  if (asrText) {
    for (const attachment of result) {
      if (attachment.kind === 'voice' && !attachment.asrText) attachment.asrText = asrText;
    }
  }

  return result;
}

/** 帖子附件：files[{name,url,file_id}] + images[] */
function normalizePostAttachments(data: TuituiTeamsPostData): InboundAttachment[] {
  const attachments: InboundAttachment[] = [];
  for (const image of data.images ?? []) {
    const url = mediaUrl(image);
    if (url) attachments.push({ kind: 'image', url, mimeType: 'image/*' });
  }
  for (const file of data.files ?? []) {
    if (!file?.url) continue;
    attachments.push({
      kind: 'file',
      url: file.url,
      ...(file.name ? { filename: file.name } : {}),
      ...(file.file_id ? { fileId: file.file_id } : {}),
    });
  }
  return attachments;
}

/** MIME → 附件类别 */
export function classifyMime(mimeType: string | undefined): InboundAttachment['kind'] {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'voice';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

function firstString(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function stringifyValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

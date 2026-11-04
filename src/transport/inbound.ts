/**
 * 入站处理器 — 经中间件链处理后的消息 → dsh Agent followup
 *
 * 内容组装逻辑分五层：
 * - Layer 1: userContent（文本 + 语音转录 + 附件类型标签）
 * - Layer 2: quotePart（引用消息块）
 * - Layer 3: userMessage（带发送者标签）
 * - Layer 4: dynamicCtx（媒体元数据）
 * - Layer 5: agentBody（history + base 拼合）
 *
 * 推推差异只在标签与历史键：
 * - 群聊发送者标签用 `[昵称 (域账号)]`（推推有域账号，比 openid 可读得多）；
 * - 团队帖子标签追加频道名 `[昵称 (域账号) · 频道名]`，因为同一用户可能从多个
 *   频道发来消息，只给昵称无法分辨上下文；
 * - 回复后清历史的作用域从"仅群聊"扩到"群聊 + 帖子"，两者都靠 @ 触发并共享
 *   同一份历史缓冲，不清会让下次 @ 时重复组包。
 *
 * 注意：`ctx.state.envelope` 由中间件的 envelopeFormatter 生成，但 inbound
 * 不使用它（自行按 history/quote/mention 重建，envelope 主要服务于
 * concurrency-guard 的消息合并）。保持这个分工，避免两套组装互相污染。
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { SessionManager } from '../session/index.ts';
import type { ImTuituiConfig } from '../config.ts';
import type {
  ChatScope,
  HistoryEntry,
  InboundAttachment,
  Logger,
  MiddlewareContext,
  MiddlewareState,
  ProcessedAttachment,
  ReplyTarget,
} from '../types.ts';
import { getScopePeer, resolveScopeStrategy } from '../shared/index.ts';
import {
  classifyContentType,
  isVoiceContentType,
  mediaFilename,
  type MediaKind,
} from './attachment.ts';
import { clearGroupHistory } from '../features/history-store.ts';

// ── 主处理函数 ──

/**
 * 处理推推入站消息（已经过中间件链）
 *
 * 阻塞等待本轮 turn 收敛（whenIdle），避免后续消息在 turn 运行期间被 followup 打断；
 * 会话创建失败时用 ctx.bot 兜底回复，绝不静默无响应。
 */
export async function handleInbound(
  ctx: MiddlewareContext,
  manager: SessionManager,
  config: ImTuituiConfig,
  logger: Logger,
): Promise<void> {
  const msg = ctx.message;
  const state = ctx.state;
  const { bot } = ctx;

  const { scope, peerId } = getScopePeer(msg);
  // 出站目标由 gateway 统一构造（含 msgId / post 定位），这里不再二次推导
  const replyTarget: ReplyTarget = ctx.replyTarget;

  // ── 组装 agentBody（下载结果经 state.downloadedFiles 提供） ──
  const agentBody = assembleAgentBody(msg, state, scope, logger);

  if (!agentBody) return;

  logger.info(`Processing: scope=${scope} peerId=${peerId} body="${agentBody.slice(0, 200)}"`);

  // ── 获取或创建会话 ──
  let record;
  try {
    record = await manager.getOrCreate(scope, peerId, msg.senderId, replyTarget);
  } catch (err) {
    logger.error(`ERROR creating session: ${err instanceof Error ? err.message : String(err)}`);
    // 兜底回复：会话创建失败时告知用户，避免静默无响应
    try {
      await bot.sendMarkdown(replyTarget, '⚠️ 处理消息时出现异常，请稍后重试。');
    } catch (sendErr) {
      logger.error(`fallback reply failed: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
    }
    return;
  }

  // ── 构建 UserMessage → followup ──
  const content: ContentBlock[] = [{ type: 'text' as const, text: agentBody }];

  const message = createUserMessage({
    content,
    source: { kind: 'user' as const },
  });

  /**
   * 并发策略必须在 turn 这一层执行。
   *
   * 中间件链跑完就 release 了，turn 还在飞——只靠链上的并发守卫，私聊配了
   * 「打断」照样会排到前一轮后面。这里按作用域再判一次：abort 先取消在飞的
   * 那一轮再投递，drop 忙时直接丢。
   */
  const strategy = resolveScopeStrategy(config, scope);
  if ((strategy === 'abort' || strategy === 'drop') && record.agent.status === 'running') {
    if (strategy === 'drop') {
      logger.info(`[concurrency] 忙时丢弃: scope=${scope} peer=${peerId}`);
      return;
    }
    logger.info(`[concurrency] 打断在飞回合，直接接新话: scope=${scope} peer=${peerId}`);
    record.agent.cancel({ kind: 'user' });
    // 等旧回合真正收敛再投递，否则 followup 会追加到被取消的那一轮尾巴上
    try {
      await record.agent.whenIdle();
    } catch (err) {
      logger.warn(`cancel 后等待收敛失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  record.agent.followup(message);
  logger.info(`→ followup sent: key=${scope}:${peerId}`);

  // 群聊/帖子回复后清空历史缓存（避免下次 @ 时重复组包）。
  // 历史键与 middleware-setup 的 groupKey 完全一致，否则清不到同一份缓冲。
  const historyKey = historyKeyOf(msg, scope);
  if (historyKey !== undefined) {
    clearGroupHistory(config.appId, historyKey);
  }

  try {
    await record.agent.whenIdle();
  } catch (err) {
    logger.warn(`whenIdle rejected: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 历史缓冲键：群聊用 group_id，帖子用 teamId/channelId（与 middleware-setup 对齐） */
function historyKeyOf(msg: MiddlewareContext['message'], scope: ChatScope): string | undefined {
  if (scope === 'group') return msg.groupId ?? msg.senderId;
  if (scope === 'post' && msg.post !== undefined) {
    return `${msg.post.teamId}/${msg.post.channelId}`;
  }
  return undefined;
}

// ══════════════════════════════════════════════════════════════
// Body Assembly（5 层组装）
// ══════════════════════════════════════════════════════════════

/**
 * 组装 agentBody — AI 实际看到的完整上下文
 */
function assembleAgentBody(
  msg: MiddlewareContext['message'],
  state: MiddlewareState,
  scope: ChatScope,
  logger: Logger,
): string | null {
  const multiUser = scope !== 'c2c';
  const wasMentioned = state.mention?.wasMentioned ?? false;

  const userContent = buildUserContent(msg, state, logger);

  if (isEmptyMessage(userContent, msg.attachments, multiUser, wasMentioned)) return null;

  const quotePart = buildQuotePart(state.quote);
  const userMessage = buildUserMessage(userContent, quotePart, msg, scope, wasMentioned);

  const dynamicCtx = buildDynamicCtx(msg, state);

  const base = dynamicCtx ? `${dynamicCtx}${userMessage}` : userMessage;
  return buildAgentBody(base, state.history, multiUser, wasMentioned);
}

/**
 * 判断消息是否为空：无文本/语音/附件，且非群聊/帖子 @。
 * 被 @ 视为有效触发信号，即使内容为空也保留给 agent。
 */
function isEmptyMessage(
  userContent: string,
  attachments: InboundAttachment[] | undefined,
  multiUser: boolean,
  wasMentioned: boolean,
): boolean {
  if (userContent) return false;
  if (attachments && attachments.length > 0) return false;
  if (multiUser && wasMentioned) return false;
  return true;
}

/**
 * Layer 1: 用户文本内容 + 语音转录 + 附件类型标签（媒体路径由 buildDynamicCtx 提供）
 */
function buildUserContent(
  msg: MiddlewareContext['message'],
  state: MiddlewareState,
  logger: Logger,
): string {
  const parts: string[] = [];

  const text = (msg.content ?? '').trim();
  if (text) {
    parts.push(text);
  }

  const voiceTexts = extractVoiceTexts(msg.attachments, state.processedAttachments, logger);
  if (voiceTexts.length > 0) {
    for (const vt of voiceTexts) {
      const durationTag = vt.duration ? ` (${vt.duration}s)` : '';
      parts.push(`[Voice message${durationTag}] ${vt.text}`);
    }
  }

  // 附件类型标签（媒体路径由 buildDynamicCtx 提供，这里只提示「带了什么」）
  const attachmentTags = buildAttachmentTags(msg.attachments);
  if (attachmentTags) {
    parts.push(attachmentTags);
  }

  return parts.join('\n');
}

/**
 * Layer 2: 引用消息块
 */
function buildQuotePart(quote?: MiddlewareState['quote']): string {
  if (!quote?.text) return '';

  return `[Quoted message begins]\n${quote.text}\n[Quoted message ends]\n[Current message]\n`;
}

/**
 * Layer 3: 带发送者标签的用户消息
 */
function buildUserMessage(
  userContent: string,
  quotePart: string,
  msg: MiddlewareContext['message'],
  scope: ChatScope,
  wasMentioned: boolean,
): string {
  if (scope === 'c2c') {
    return `${quotePart}${userContent}`;
  }

  const mentionTag = wasMentioned ? ' (@you)' : '';
  const displayName = msg.senderName || shortSenderId(msg.senderId || msg.senderAccount);
  const account = msg.senderAccount || shortSenderId(msg.senderId);
  const senderTag = scope === 'post'
    ? `[${displayName} (${account}) · ${msg.post?.channelName ?? '频道'}]`
    : `[${displayName} (${account})]`;
  return `${quotePart}${senderTag} ${userContent}${mentionTag}`;
}

/**
 * Layer 4: 媒体元数据上下文（图片/视频/文件本地路径 + 语音 ASR + 引用附件）
 */
function buildDynamicCtx(msg: MiddlewareContext['message'], state: MiddlewareState): string {
  const lines: string[] = [];

  if (msg.attachments && msg.attachments.length > 0) {
    const downloadedByFilename = new Map((state.downloadedFiles ?? []).map(d => [d.filename, d]));
    const voices: InboundAttachment[] = [];

    // 一次遍历归类 + 生成媒体行
    for (const att of msg.attachments) {
      const kind = classifyContentType(att.mimeType ?? att.kind);
      if (kind === 'voice') {
        voices.push(att);
        continue;
      }
      const downloaded = downloadedByFilename.get(mediaFilename(att));
      lines.push(`- ${renderMediaLine(kind, att.filename, downloaded?.localPath, att.url, att.size)}`);
    }

    // 语音：有 ASR 文本才带文本，否则只带链接（纯文本模型无法消费音频）
    if (voices.length > 0) {
      const asrTexts = voices.map(a => a.asrText).filter((text): text is string => Boolean(text));
      if (asrTexts.length > 0) {
        lines.push(`- ASR: ${asrTexts.join(' | ')}`);
      } else {
        const urls = voices.map(a => a.url).filter((url): url is string => Boolean(url));
        if (urls.length > 0) lines.push(`- Voice: ${urls.join(', ')}`);
      }
    }
  }

  // 引用消息的附件（独立于当前消息媒体，不受上一步为空影响）
  const quoteAttachments = msg.reference?.attachments;
  if (quoteAttachments && quoteAttachments.length > 0) {
    const downloadedQuote = new Map((state.downloadedQuoteFiles ?? []).map(d => [d.filename, d]));
    lines.push('[Reference attachments]');
    for (const qa of quoteAttachments) {
      const kind = classifyContentType(qa.mimeType ?? qa.kind);
      if (kind === 'voice') {
        if (qa.asrText) lines.push(`  - Voice: ${qa.asrText}`);
        continue;
      }
      const downloaded = downloadedQuote.get(mediaFilename(qa));
      lines.push(`  - ${renderMediaLine(kind, qa.filename, downloaded?.localPath, qa.url, qa.size)}`);
    }
  }

  return lines.length > 0 ? `${lines.join('\n')}\n\n` : '';
}

/**
 * 渲染单个媒体附件（image/video/file）的上下文行内容，不含列表前缀。
 * 当前消息与引用消息共用，保证附件格式统一。语音不在此处理（见 buildDynamicCtx）。
 */
function renderMediaLine(
  kind: Exclude<MediaKind, 'voice'>,
  filename: string | undefined,
  localPath: string | undefined,
  url: string | undefined,
  size: number | undefined,
): string {
  switch (kind) {
    case 'image':
      return localPath
        ? `Image: ${localPath}`
        : `Image: ${url ?? filename ?? 'image'}`;
    case 'video':
      return localPath
        ? `Video: ${localPath}`
        : `Video: ${filename ?? 'video'} (download failed)`;
    case 'file':
      return localPath
        ? `File: ${localPath}`
        : `File: ${filename ?? 'file'} (${formatFileSize(size ?? 0)})`;
  }
}

/**
 * Layer 5: 最终 agentBody 拼合
 */
function buildAgentBody(
  base: string,
  history: HistoryEntry[] | undefined,
  multiUser: boolean,
  wasMentioned: boolean,
): string {
  if (!multiUser || !wasMentioned || !history || history.length === 0) {
    return base;
  }

  const historyLines = history.map((entry) => {
    const name = entry.senderName ?? shortSenderId(entry.senderId);
    return `[${name} (${entry.senderId})] ${entry.content}`;
  });

  return [
    '[Chat history begins]',
    ...historyLines,
    '',
    '[Chat history ends]',
    '[Current message]',
    base,
  ].join('\n');
}

// ══════════════════════════════════════════════════════════════
// 辅助函数
// ══════════════════════════════════════════════════════════════

interface VoiceText {
  text: string;
  duration?: number;
  source: 'stt' | 'asr' | 'fallback';
}

function extractVoiceTexts(
  attachments?: InboundAttachment[],
  processed?: ProcessedAttachment[],
  _logger?: Logger,
): VoiceText[] {
  const results: VoiceText[] = [];

  if (processed) {
    for (const pa of processed) {
      if (pa.type === 'voice' && pa.voiceText) {
        results.push({
          text: pa.voiceText,
          ...(pa.duration !== undefined ? { duration: pa.duration } : {}),
          source: pa.voiceSource ?? 'stt',
        });
      }
    }
  }

  if (results.length === 0 && attachments) {
    for (const att of attachments) {
      if (isVoiceContentType(att.mimeType ?? att.kind) && att.asrText) {
        results.push({
          text: att.asrText.trim(),
          source: 'asr',
        });
      }
    }
  }

  return results;
}

/**
 * 附件类型标签（Layer 1 用户消息主体里的轻量提示）。
 * 只标注「带了什么类型的附件」，去重；媒体本地路径在 buildDynamicCtx 提供。
 */
function buildAttachmentTags(attachments?: InboundAttachment[]): string {
  if (!attachments || attachments.length === 0) return '';

  const labels: Record<string, string> = {
    image: '[图片]',
    video: '[视频]',
    file: '[文件]',
  };

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const att of attachments) {
    const kind = classifyContentType(att.mimeType ?? att.kind);
    if (kind === 'voice' || seen.has(kind)) continue;
    seen.add(kind);
    const label = labels[kind];
    if (label) tags.push(label);
  }

  return tags.join(' ');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** 发送者短标识长度（无昵称时兜底） */
const SENDER_SHORT_ID_LEN = 8;

/** 无昵称时用 id 前 N 位作为匿名标识 */
function shortSenderId(senderId: string): string {
  return senderId.slice(0, SENDER_SHORT_ID_LEN);
}

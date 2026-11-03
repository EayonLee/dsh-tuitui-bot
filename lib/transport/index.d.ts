/**
 * 传输层
 *
 * 协议对接：推推消息入站 / 出站 / Markdown 切分。
 * gateway 只从这里取入口，不直接触碰内部模块。
 */
export { handleInbound } from './inbound.ts';
export { createOutboundHandler } from './outbound.ts';
export { OutboundBuffer, type OutboundSenderLike } from './outbound-buffer.ts';
export { chunkMarkdownText } from './chunker.ts';
export { StreamingWriter } from './streaming-writer.ts';
export { ReplyLimiter } from './reply-limiter.ts';
export type { ReplyLimiterConfig, ReplyLimitResult } from './reply-limiter.ts';
export { cacheMsgId, cacheEventId, getCachedReplyIds, getMsgId } from './msgid-cache.ts';
export type { CachedReplyId, ReplyIdKind } from './msgid-cache.ts';
export { resolveReplyTarget, resolveToTarget, sendResolvedMarkdown, sendThrottledMarkdown, isPostTarget } from './reply-target.ts';
export type { TuituiToTarget, MarkdownSenderLike, ResolveReplyTargetOptions } from './reply-target.ts';
export { parseEvent, parseStreamFrame, extractTurnError } from './events.ts';
export type { RawSessionEvent, OutboundEvent, PresentedFileRef, StreamFrameDelta } from './events.ts';
export { formatToolResult } from './tool-presenter.ts';
export type { ToolsRegistryLike, ToolResultData } from './tool-presenter.ts';
export { DeliverablesDeliverer } from './deliverables.ts';
export type { DeliverablesDelivererLike } from './deliverables.ts';
export { downloadMessageMedia, downloadMediaAttachments, classifyContentType, isImageContentType, isVideoContentType, isVoiceContentType, imageExtension, correctImageExt, mediaFilename, } from './attachment.ts';
export type { DownloadedFile, MediaKind, MessageMediaDownload, FileUrlResolver } from './attachment.ts';
//# sourceMappingURL=index.d.ts.map
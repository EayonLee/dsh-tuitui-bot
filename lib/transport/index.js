/**
 * 传输层
 *
 * 协议对接：推推消息入站 / 出站 / Markdown 切分。
 * gateway 只从这里取入口，不直接触碰内部模块。
 */
export { handleInbound } from "./inbound.js";
export { createOutboundHandler } from "./outbound.js";
export { OutboundBuffer } from "./outbound-buffer.js";
export { chunkMarkdownText } from "./chunker.js";
export { StreamingWriter } from "./streaming-writer.js";
export { ReplyLimiter } from "./reply-limiter.js";
export { cacheMsgId, cacheEventId, getCachedReplyIds, getMsgId } from "./msgid-cache.js";
export { resolveReplyTarget, resolveToTarget, sendResolvedMarkdown, sendThrottledMarkdown, isPostTarget } from "./reply-target.js";
export { parseEvent, parseStreamFrame, extractTurnError } from "./events.js";
export { formatToolResult } from "./tool-presenter.js";
export { DeliverablesDeliverer } from "./deliverables.js";
export { downloadMessageMedia, downloadMediaAttachments, classifyContentType, isImageContentType, isVideoContentType, isVoiceContentType, imageExtension, correctImageExt, mediaFilename, } from "./attachment.js";
//# sourceMappingURL=index.js.map
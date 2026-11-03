/**
 * 中间件模块汇总
 *
 * 提供洋葱模型内核 + 覆盖上游全部内置中间件的一套实现：
 *
 * **内核**
 * - {@link MiddlewareKernel} — use/dispatch，skip 语义与上游 stop 一致
 * - {@link createMiddlewareContext} — 构造一次消息处理的上下文
 *
 * **过滤与保护**
 * - {@link messageFilter} — 自回声 + 去重
 * - {@link accessPolicy} — c2c/group/post 名单门控（空名单 fail-closed）
 * - {@link rateLimiter} — 三层滑动窗口限流
 * - {@link concurrencyGuard} — 同 peer 串行 + merge 合并
 *
 * **门控与清洗**
 * - {@link mentionGate} — 群聊/帖子 @ 门控
 * - {@link contentSanitizer} — 去提及标记、折叠空白（保护代码块）
 *
 * **协议与上下文**
 * - {@link historyBuffer} — 群/频道历史环形缓冲
 * - {@link quoteRef} — 引用解析 + 索引
 * - {@link attachmentProcessor} — 富媒体下载
 * - {@link envelopeFormatter} — 组装 prompt 信封
 *
 * **交互**
 * - {@link slashCommand} — 斜杠命令派发
 * - {@link questionAnswer} — 待答问题截获
 * - {@link typingIndicator} — 收消息回执（emoji reaction）
 *
 * **兜底**
 * - {@link errorHandler} — 捕获下游异常并回执
 *
 * 顺序由 gateway/middleware-setup.ts 决定（与上游逐条对应）。
 */
export { MiddlewareKernel, createMiddlewareContext } from "./kernel.js";
export { errorHandler } from "./error-handler.js";
export { messageFilter } from "./message-filter.js";
export { accessPolicy } from "./access-policy.js";
export { mentionGate } from "./mention-gate.js";
export { contentSanitizer } from "./content-sanitizer.js";
export { rateLimiter, DEFAULT_RATE_LIMITS } from "./rate-limiter.js";
export { concurrencyGuard } from "./concurrency-guard.js";
export { historyBuffer, MemoryHistoryStore, defaultHistoryKey } from "./history-buffer.js";
export { slashCommand } from "./slash-command.js";
export { questionAnswer } from "./question-answer.js";
export { typingIndicator } from "./typing-indicator.js";
export { quoteRef, MemoryRefIndexStore } from "./quote-ref.js";
export { attachmentProcessor } from "./attachment.js";
export { envelopeFormatter } from "./envelope-formatter.js";
//# sourceMappingURL=index.js.map
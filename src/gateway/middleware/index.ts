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
 * - {@link receiptReactions} — 收消息回执（emoji reaction：在算 / 好了 / 出错）
 *
 * **兜底**
 * - {@link errorHandler} — 捕获下游异常并回执
 *
 * 顺序由 gateway/middleware-setup.ts 决定（与上游逐条对应）。
 */
export { MiddlewareKernel, createMiddlewareContext } from './kernel.ts';
export { errorHandler } from './error-handler.ts';
export type { ErrorHandlerOptions } from './error-handler.ts';

export { messageFilter } from './message-filter.ts';
export type { MessageFilterOptions } from './message-filter.ts';

export { accessPolicy } from './access-policy.ts';
export type { AccessMatcher, AccessPolicy, ScopePolicy } from './access-policy.ts';

export { mentionGate } from './mention-gate.ts';
export type { MentionDecision, MentionGateOptions } from './mention-gate.ts';

export { contentSanitizer } from './content-sanitizer.ts';
export type { ContentSanitizerOptions } from './content-sanitizer.ts';

export { rateLimiter, DEFAULT_RATE_LIMITS } from './rate-limiter.ts';
export type { RateLimitTier, RateLimiterOptions, RateLimitTierName } from './rate-limiter.ts';

export { concurrencyGuard } from './concurrency-guard.ts';
export type { ConcurrencyGuardOptions, ConcurrencyStrategy } from './concurrency-guard.ts';

export { historyBuffer, MemoryHistoryStore, defaultHistoryKey } from './history-buffer.ts';
export type { HistoryBufferOptions, HistoryStore } from './history-buffer.ts';

export { slashCommand } from './slash-command.ts';
export type {
  CommandEntry,
  ParsedCommand,
  SlashCommandHandlerContext,
  SlashCommandMiddleware,
  SlashCommandOptions,
  SlashCommandResult,
} from './slash-command.ts';

export { questionAnswer } from './question-answer.ts';
export type {
  QuestionAnswerHost,
  QuestionAnswerOptions,
  QuestionChannelLike,
} from './question-answer.ts';

export { receiptReactions, typingIndicator } from './typing-indicator.ts';
export type { TypingIndicatorOptions } from './typing-indicator.ts';

export { quoteRef, MemoryRefIndexStore } from './quote-ref.ts';
export type { QuoteRefOptions, RefEntry, RefIndexStore, ResolvedQuote } from './quote-ref.ts';

export { attachmentProcessor } from './attachment.ts';
export type { MediaDownloadResult } from './attachment.ts';

export { envelopeFormatter } from './envelope-formatter.ts';
export type { EnvelopeFormatterOptions } from './envelope-formatter.ts';

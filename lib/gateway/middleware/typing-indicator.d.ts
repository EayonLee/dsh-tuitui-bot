/**
 * 收消息回执中间件 — 用 emoji reaction 告诉用户「我看到了，在算」
 *
 * 推推没有「输入中」状态通知，但消息支持表情回应（emojiReaction）。
 * 给用户刚发的那条消息挂一个 👀，效果等价且更轻：不需要发消息、不会刷屏、
 * 不会占用引用回复位置。
 *
 * 只对单聊做：
 *   - 群聊里给每条消息挂表情很吵，而且 @ 门控已经筛过一轮；
 *   - 帖子（teams post）的 reaction 是另一个 API 面，出站发送器未必实现。
 *
 * 实现决策：不做 durationSec / keepAlive 续期 —— 表情回应是一直挂着的，
 * 推推的 reaction 一旦挂上就一直在，没有续期概念，因此这里不需要定时器
 * （也就不必在 `next()` 之后清理 timer）。
 */
import type { Logger, Middleware, MiddlewareContext } from '../../types.ts';
export interface TypingIndicatorOptions {
    /** 只对通过 predicate 的消息回应，默认全部 */
    predicate?: (ctx: MiddlewareContext) => boolean;
    /** 回执表情，默认 👀 */
    emoji?: string;
    /** 是否等待 reaction 调用完成再继续（默认 false，fire-and-forget） */
    awaitReaction?: boolean;
    logger?: Logger;
}
export declare function typingIndicator(options?: TypingIndicatorOptions): Middleware;
//# sourceMappingURL=typing-indicator.d.ts.map
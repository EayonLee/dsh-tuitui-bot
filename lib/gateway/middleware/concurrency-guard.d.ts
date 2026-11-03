/**
 * 并发守卫中间件 — 同一个 peer 上串行处理消息
 *
 * 同一个会话同时跑两轮 turn 会互相打断：流式输出抢同一个 msgid、会话上下文
 * 交错、工具调用互相覆盖。推推平台侧没有「同一会话只能一个流」的限制，
 * 所以这道闸只能自己加（上游是为了避开 QQ 平台的 500 错误，本插件是为了
 * 会话正确性 —— 两个理由指向同一套状态机）。
 *
 * 四种策略（与上游一致）：
 *   - queue：后来的消息等前一条处理完（默认）
 *   - drop ：忙时静默丢弃
 *   - abort：中断当前这条，立刻处理新的
 *   - merge：忙时把新消息缓冲起来，当前这条处理完后合并成一条幸存 ctx，
 *            由幸存者自己 `next()` 继续往下走（非幸存者静默返回，链自然停下）
 *
 * 并发键是 `${scope}:${targetId}`（单聊按对方账号、群按 group_id、帖子按 channel_id）。
 *
 * merge 的实现要点（上游的核心设计，照搬）：
 *   当前消息 A 立即全速跑；B/C/D 停在 promise 上**不调用 ctx.stop()**，
 *   等 A 跑完统一合并，选一个幸存者继续，其余等待者直接返回。
 *   这样 A 的延迟为 0、缓冲批次只处理一次、非幸存者不需要额外的 stop 标记。
 *
 * 与上游的差异：上游用 `ctx.abort()` 播 AbortSignal 来中断下游；本插件的
 * MiddlewareContext 契约里没有 signal，改用同等效果的两件事：
 *   1. `ctx.skip()` —— 让下游所有 pending 的 next() 立刻返回（链停住）；
 *   2. `onInterrupt` 回调 —— 由集成方接上 SessionManager 的 cancel，
 *      真正取消在飞的模型调用 / 工具执行。
 */
import type { Logger, Middleware, MiddlewareContext } from '../../types.ts';
export type ConcurrencyStrategy = 'queue' | 'drop' | 'abort' | 'merge';
export interface ConcurrencyGuardOptions {
    /** 忙时策略，默认 queue */
    strategy?: ConcurrencyStrategy;
    /**
     * 单条消息最长处理时长(ms)，超时中断并放行队列；0 = 不限（默认 0）。
     * 上限保护的是「模型卡死导致这个 peer 永久占锁」。
     */
    maxProcessingMs?: number;
    /** 每目标最大排队数（queue）/ 最大缓冲数（merge），默认 3 */
    maxQueue?: number;
    /** 被丢弃时回调（drop 或溢出） */
    onDrop?: (ctx: MiddlewareContext) => void | Promise<void>;
    /** merge 策略的合并函数，必须返回缓冲数组中的一个作为幸存者 */
    onMerge?: (buffered: MiddlewareContext[]) => MiddlewareContext;
    /** @deprecated 上游遗留：合并后走回调派发，而不是幸存者自己 next() */
    onDispatch?: (ctx: MiddlewareContext) => void | Promise<void>;
    /** 紧急消息探针（如 /stop）：跳过缓冲直接并行处理，并清掉已缓冲的消息 */
    urgentPredicate?: (ctx: MiddlewareContext) => boolean;
    /** 中断当前处理时的回调（接 manager.cancel），reason 用于日志与排查 */
    onInterrupt?: (ctx: MiddlewareContext, reason: string) => void | Promise<void>;
    logger?: Logger;
}
export declare function concurrencyGuard(options?: ConcurrencyGuardOptions): Middleware;
//# sourceMappingURL=concurrency-guard.d.ts.map
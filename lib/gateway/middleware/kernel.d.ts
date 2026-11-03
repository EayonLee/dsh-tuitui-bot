/**
 * 中间件内核 — 洋葱模型 + skip 语义 + 兜底日志
 *
 * 上游这套逻辑由 SDK 提供（`runMiddlewareChain` / `createMiddlewareContext`），
 * 本插件没有 SDK 可依赖，于是原地复刻成一个可实例化的内核：网关启动时只需
 * 按上游相同顺序 `use()`，再对每条入站消息 `dispatch(ctx)`。
 *
 * 与上游的两处差异（都是传输层替换，不改语义）：
 *   1. 上游内核把异常抛回 `bot.emit('error')`，由宿主决定是否上报；推推没有
 *      等价的总线，异常一旦抛出就会变成未捕获拒绝，所以在这里一次性吞掉并记
 *      错误日志 —— 等价于上游链首的 `errorHandler()` 中间件。
 *   2. 上游 `ctx.stop()` 后仍会逐层进入下游中间件（由各中间件自己检查），本实现
 *      与之一致：`dispatch` 在每层入口检查 `ctx.skipped`，命中即返回，因此
 *      `skip()` 之后所有 pending 的 `next()` 都会立即返回。
 */
import type { InboundMessage, Logger, Middleware, MiddlewareContext, ReplyTarget, TuituiSender } from '../../types.ts';
/** 中间件链（洋葱模型） */
export declare class MiddlewareKernel {
    private readonly middlewares;
    private readonly logger;
    constructor(logger?: Logger);
    /** 追加一层中间件，返回自身便于链式编排 */
    use(mw: Middleware): this;
    /** 已注册层数（诊断用） */
    get size(): number;
    /**
     * 派发一条消息。
     *
     * 任何一层抛出的异常都在这里收敛：只记日志，绝不重新抛出，避免打断事件循环
     * 或让上一条消息的失败影响后续消息。
     */
    dispatch(ctx: MiddlewareContext): Promise<void>;
}
/**
 * 构造一条消息的中间件上下文。
 *
 * 对应上游 SDK 的 `createMiddlewareContext`。`skip` 只记录第一次的原因，
 * 后续重复 skip 不覆盖，便于排查「到底被哪一层拦下」。
 */
export declare function createMiddlewareContext(params: {
    message: InboundMessage;
    replyTarget: ReplyTarget;
    bot: TuituiSender;
    state?: Record<string, unknown>;
}): MiddlewareContext;
//# sourceMappingURL=kernel.d.ts.map
/**
 * 错误兜底中间件 — 捕获下游异常，记日志并尽量给用户一个可读的答复
 *
 * 放在链首（最外层洋葱皮），才能看到所有下游阶段（含最终入站处理）的异常。
 * 推推的出站发送本身也可能失败（网络 / 权限），所以「发错误提示」这一步
 * 必须再包一层 try：兜底里再抛异常就真的没人接住了。
 *
 * 默认吞掉异常（不 rethrow）：一次消息处理失败不该让事件循环崩掉，也不该
 * 影响这条连接上的后续消息。
 */
import type { Logger, Middleware, MiddlewareContext } from '../../types.ts';
export interface ErrorHandlerOptions {
    /** 自定义错误文案；返回空串/undefined 表示不回复 */
    format?: (err: Error, ctx: MiddlewareContext) => string | undefined;
    /** 返回 false 的异常不回复也不记日志（如已被 ctx.skip 的常规门控） */
    filter?: (err: Error) => boolean;
    /** 捕获后是否继续抛出（默认 false） */
    rethrow?: boolean;
}
export declare function errorHandler(logger?: Logger, options?: ErrorHandlerOptions): Middleware;
//# sourceMappingURL=error-handler.d.ts.map
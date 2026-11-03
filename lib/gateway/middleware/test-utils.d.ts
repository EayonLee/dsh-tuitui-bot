/**
 * 中间件单测的公共脚手架
 *
 * 刻意不依赖 vitest：本文件会被 tsc 一起编译（tsconfig 只排除 *.test.ts），
 * 保持纯函数与零副作用，才不会让测试工具混进生产构建。
 */
import type { InboundMessage, Middleware, MiddlewareContext, ReplyTarget, TuituiSender } from '../../types.ts';
/** 造一条入站消息（默认群聊场景） */
export declare function makeMessage(partial?: Partial<InboundMessage>): InboundMessage;
/** 造一个只记录调用的假 sender */
export declare function makeBot(overrides?: Partial<TuituiSender>): TuituiSender;
/** 由消息推导回复目标（与 tuitui/inbound 的推导规则一致） */
export declare function makeReplyTarget(message: InboundMessage): ReplyTarget;
/** 造一个完整的中间件上下文 */
export declare function makeCtx(message?: InboundMessage, bot?: TuituiSender): MiddlewareContext;
/** 跑一层中间件，返回「下游是否被调用」 */
export declare function runMiddleware(middleware: Middleware, ctx: MiddlewareContext): Promise<{
    reachedNext: boolean;
}>;
/** 可控的延迟闸门：用于断言「上一条没处理完时发生了什么」 */
export declare function createGate(): {
    wait: Promise<void>;
    open: () => void;
};
//# sourceMappingURL=test-utils.d.ts.map
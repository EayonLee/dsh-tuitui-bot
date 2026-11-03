/**
 * 中间件编排 — 与上游 dsh-qqbot 完全相同的顺序
 *
 * 上游这层依赖 @tencent-connect/qqbot-nodejs 内置的洋葱链；推推 SDK 没有中间件
 * 概念，因此由我们自己的 gateway/middleware 内核提供等价能力。顺序是行为契约：
 * 访问控制必须在历史缓冲之前（拒绝的消息不记账），@门控必须在历史缓冲之后
 * （未 @ 的消息也要进上下文），命令匹配必须早于并发串行（命令不排队）。
 */
import type { ImTuituiConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { SessionManager } from '../session/index.ts';
import type { CommandEntry } from '../commands/index.ts';
import { MiddlewareKernel } from './middleware/index.ts';
export interface MiddlewareSetupOptions {
    config: ImTuituiConfig;
    manager: SessionManager;
    logger: Logger;
    /** 命令注册表（commands/buildCommandList 产物） */
    commands: CommandEntry[];
}
/** 组装中间件链（顺序与上游逐条对应，见函数体注释编号） */
export declare function setupMiddlewares(options: MiddlewareSetupOptions): MiddlewareKernel;
//# sourceMappingURL=middleware-setup.d.ts.map
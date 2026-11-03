/**
 * 中间件编排 — 洋葱链的装配与顺序
 *
 * 推推 SDK 只有裸事件回调，没有中间件概念，因此由 gateway/middleware 内核提供
 * 洋葱链能力。顺序是行为契约：
 * 访问控制必须在历史缓冲之前（拒绝的消息不记账），@门控必须在历史缓冲之后
 * （未 @ 的消息也要进上下文），命令匹配必须早于并发串行（命令不排队）。
 */
import type { ImTuituiConfig } from '../config.ts';
import type { Logger, MiddlewareContext } from '../types.ts';
import type { SessionManager } from '../session/index.ts';
import type { CommandEntry } from '../commands/index.ts';
import { MiddlewareKernel } from './middleware/index.ts';
/** 智能插话判定所需的外部依赖（模型 + 会话模型路线 + 机器人自称） */
export interface SmartJudgeDeps {
    /** ctx.llm 服务（缺失即退化为规则判定） */
    llm: unknown;
    /** 按消息解析生效的模型路线 */
    resolveRoute: (ctx: MiddlewareContext) => {
        provider: string;
        model: string;
    } | undefined;
    /** 机器人名字（提示词里用） */
    botName: string;
    /** 判定参数（来自 config.smartJudge） */
    settings: {
        enabled: boolean;
        maxHistory: number;
        maxTokens: number;
        timeoutMs: number;
        cooldownMs: number;
        /** 自定义判定提示词（空则用内置默认） */
        prompt: string;
    };
}
export interface MiddlewareSetupOptions {
    config: ImTuituiConfig;
    manager: SessionManager;
    logger: Logger;
    /** 命令注册表（commands/buildCommandList 产物） */
    commands: CommandEntry[];
    /** 智能插话判定依赖；不给则 smart 模式退回确定性规则 */
    smartJudge?: SmartJudgeDeps;
}
/** 组装中间件链（顺序与上游逐条对应，见函数体注释编号） */
export declare function setupMiddlewares(options: MiddlewareSetupOptions): MiddlewareKernel;
//# sourceMappingURL=middleware-setup.d.ts.map
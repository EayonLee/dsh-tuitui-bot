/**
 * @ 门控中间件 — 决定一条群聊 / 帖子消息该不该回复
 *
 * 群聊与团队频道里绝大多数消息不是对机器人说的，需要 @ 才响应才能避免打扰。
 * 判定结果写进 `ctx.state.mention`，供下游（历史缓冲、入站组装）复用，
 * 这样「不回应但仍记账」才能成立。
 *
 * 推推的原生信号很干净：事件体直接带 `at_me` 布尔位（群聊与帖子都有），
 * 不需要再扫内容里的 `<@!appId>` 标记，也不存在「同一事件既推全量又推 @ 版」的歧义。
 * 因此判定优先级是：
 *   1. `message.atMe`（推推权威信号）
 *   2. `isImplicitMention`（业务自定义的隐式 @，例如「回复了机器人某条消息」）
 */
import type { Logger, Middleware, MiddlewareContext } from '../../types.ts';
export interface MentionDecision {
    /** 是否被显式 @ */
    wasMentioned: boolean;
    /** 是否命中隐式 @ 规则 */
    implicit: boolean;
    /** 最终是否应该回应 */
    shouldAnswer: boolean;
    /** shouldAnswer=false 时的原因 */
    reason: 'no_mention' | 'other_mention' | 'passthrough';
    /** 实际生效的触发策略（便于日志与测试断言） */
    policy?: 'require' | 'always' | 'smart';
}
export interface MentionGateOptions {
    /** 群聊是否必须 @，默认 true（policy 未给时的兜底推导） */
    requireMentionInGroup?: boolean;
    /** 团队帖子是否必须 @，默认 true */
    requireMentionInPost?: boolean;
    /**
     * 触发策略（优先于上面两个布尔）：
     *   require=仅 @ 才回；always=全部回；smart=不 @ 也回，但只回相关消息
     */
    policy?: 'require' | 'always' | 'smart';
    /**
     * smart 模式的插话判定探针。
     *
     * 允许异步：真正的智能模式要把上下文交给模型判断，同步规则只是它的降级路径。
     */
    isSmartReply?: (ctx: MiddlewareContext) => boolean | Promise<boolean>;
    /** 单聊一律视为对机器人说，默认 true */
    alwaysAnswerC2C?: boolean;
    /** 隐式 @ 探针（如回复了机器人的消息） */
    isImplicitMention?: (ctx: MiddlewareContext) => boolean;
    /**
     * 跳过「@ 了别人但没 @ 本机器人」的消息，避免抢别人的话。
     * 默认 false：requireMention=false 时用户明确要全量响应，此项不生效。
     */
    ignoreOtherMentions?: boolean;
    /** 只标注 `state.mention` 而不中断链（历史缓冲仍要跑），默认 false */
    passthrough?: boolean;
    /** 跳过时回调（遥测 / 记账） */
    onSkip?: (ctx: MiddlewareContext, decision: MentionDecision) => void;
    /** 动态策略覆盖，优先级高于静态选项 */
    resolveConfig?: (ctx: MiddlewareContext) => {
        requireMentionInGroup?: boolean;
        requireMentionInPost?: boolean;
        ignoreOtherMentions?: boolean;
    };
    logger?: Logger;
}
export declare function mentionGate(options?: MentionGateOptions): Middleware;
//# sourceMappingURL=mention-gate.d.ts.map
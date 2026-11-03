export function mentionGate(options = {}) {
    const { requireMentionInGroup = true, requireMentionInPost = true, alwaysAnswerC2C = true, isImplicitMention, isSmartReply, onSkip, ignoreOtherMentions = false, passthrough = false, resolveConfig, } = options;
    const fixedPolicy = options.policy;
    const log = options.logger;
    /** 跳过（或仅标注）的统一出口，避免两条分支各写一遍 passthrough 逻辑 */
    async function applyDecision(ctx, decision, next) {
        // 先写 state 再判定：即使不回应，downstream 的 history/envelope 也要知道是否被 @
        ctx.state.mention = decision;
        if (!decision.shouldAnswer) {
            onSkip?.(ctx, decision);
            log?.debug(`[mention-gate] 跳过 ${ctx.message.kind} 消息（${decision.reason}）: `
                + `wasMentioned=${decision.wasMentioned}, implicit=${decision.implicit}`);
            if (!passthrough) {
                ctx.skip('mention');
                return;
            }
        }
        await next();
    }
    return async (ctx, next) => {
        const msg = ctx.message;
        // 单聊：没有「群里人多」的问题，默认永远当作对机器人说
        if (msg.kind === 'c2c') {
            const decision = {
                wasMentioned: true,
                implicit: false,
                shouldAnswer: alwaysAnswerC2C,
                reason: alwaysAnswerC2C ? 'passthrough' : 'no_mention',
            };
            await applyDecision(ctx, decision, next);
            return;
        }
        const dynamic = resolveConfig?.(ctx);
        const requireMention = msg.kind === 'group'
            ? (dynamic?.requireMentionInGroup ?? requireMentionInGroup)
            : (dynamic?.requireMentionInPost ?? requireMentionInPost);
        const ignoreOthers = dynamic?.ignoreOtherMentions ?? ignoreOtherMentions;
        // 策略优先级：显式 policy > 布尔开关推导（requireMention=false 等价于 always）
        const policy = fixedPolicy ?? (requireMention ? 'require' : 'always');
        const wasMentioned = msg.atMe === true;
        const implicit = isImplicitMention?.(ctx) ?? false;
        const smartHit = policy === 'smart' ? (isSmartReply?.(ctx) ?? false) : false;
        let shouldAnswer;
        if (policy === 'always')
            shouldAnswer = true;
        else if (policy === 'smart')
            shouldAnswer = wasMentioned || implicit || smartHit;
        else
            shouldAnswer = wasMentioned || implicit;
        let reason = shouldAnswer ? 'passthrough' : 'no_mention';
        // @ 了别人却没 @ 本机器人 → 明确判定为「不是对我说的」。
        // 只在 requireMention 生效时才有意义（否则用户要求全量响应）。
        if (ignoreOthers && policy !== 'always' && !wasMentioned && !implicit && !smartHit) {
            const others = msg.at ?? [];
            if (others.length > 0) {
                shouldAnswer = false;
                reason = 'other_mention';
            }
        }
        const decision = { wasMentioned, implicit, shouldAnswer, reason, policy };
        if (policy === 'smart' && smartHit) {
            log?.debug('[mention-gate] smart 命中：非 @ 但判定为对机器人说的消息');
        }
        await applyDecision(ctx, decision, next);
    };
}
//# sourceMappingURL=mention-gate.js.map
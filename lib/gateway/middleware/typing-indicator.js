export function typingIndicator(options = {}) {
    const emoji = options.emoji ?? '👀';
    const awaitReaction = options.awaitReaction ?? false;
    const predicate = options.predicate;
    const log = options.logger;
    return async (ctx, next) => {
        const msgId = ctx.replyTarget.msgId;
        if (ctx.message.kind !== 'c2c' || !msgId || (predicate && !predicate(ctx))) {
            await next();
            return;
        }
        const react = ctx.bot
            .emojiReaction(ctx.replyTarget, msgId, emoji)
            .catch((err) => {
            // 回执只是锦上添花：权限不足 / 消息已撤回都不该影响正常处理
            log?.debug(`[typing] 回执失败: ${err instanceof Error ? err.message : String(err)}`);
        });
        if (awaitReaction) {
            await react;
        }
        await next();
    };
}
//# sourceMappingURL=typing-indicator.js.map
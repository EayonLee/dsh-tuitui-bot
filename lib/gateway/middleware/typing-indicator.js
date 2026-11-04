export function receiptReactions(options = {}) {
    const enabled = options.enabled ?? true;
    const inGroup = options.inGroup ?? true;
    const ack = options.ack ?? '👀';
    const done = options.done ?? '✅';
    const fail = options.fail ?? '😵';
    const predicate = options.predicate;
    const log = options.logger;
    return async (ctx, next) => {
        if (!enabled) {
            await next();
            return;
        }
        const kind = ctx.message.kind;
        const allowed = kind === 'c2c' || (kind === 'group' && inGroup);
        const msgId = ctx.replyTarget.msgId;
        if (!allowed || !msgId || (predicate !== undefined && !predicate(ctx))) {
            await next();
            return;
        }
        const target = ctx.replyTarget;
        const react = (emoji, cancel = false) => {
            if (emoji === '')
                return Promise.resolve();
            return ctx.bot.emojiReaction(target, msgId, emoji, cancel).catch((err) => {
                // 回执只是锦上添花：权限不足 / 消息已撤回都不该影响正常处理
                log?.debug('[receipt] 表情回应失败: ' + (err instanceof Error ? err.message : String(err)));
            });
        };
        await react(ack);
        try {
            await next();
            await react(ack, true); // 先撤掉「在算」
            await react(done); // 再换成「好了」
        }
        catch (err) {
            await react(ack, true);
            await react(fail);
            throw err;
        }
    };
}
/** 旧名保留（文档 / 第三方引用的入口） */
export const typingIndicator = receiptReactions;
//# sourceMappingURL=typing-indicator.js.map
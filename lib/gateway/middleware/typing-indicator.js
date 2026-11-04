import { registerReceipt } from "../../features/receipt-registry.js";
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
                // 用 warn 而不是 debug：插件文件日志默认从 info 起记，debug 会被吞掉，
                // 结果就是"表情回执失效"这种事在日志里一点痕迹都没有。
                log?.warn('[receipt] 表情回应失败: ' + (err instanceof Error ? err.message : String(err)) + ' hint=应用可能没有表情回应权限');
            });
        };
        // 先挂「在算」，并登记待兑现的记录：真正的回复是之后才发出去的，
        // 换表情的时机在 sender 里 / 这一轮结束处，不在这里。
        await react(ack);
        registerReceipt({ bot: ctx.bot, target, msgId, done, fail });
        await next();
    };
}
/** 旧名保留（文档 / 第三方引用的入口） */
export const typingIndicator = receiptReactions;
//# sourceMappingURL=typing-indicator.js.map
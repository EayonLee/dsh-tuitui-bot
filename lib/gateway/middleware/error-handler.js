/** 默认文案：不暴露内部错误细节，只告诉用户「出问题了，稍后再试」 */
const DEFAULT_FORMAT = () => '⚠️ 处理消息时出现异常，请稍后重试。';
export function errorHandler(logger, options = {}) {
    const format = options.format ?? DEFAULT_FORMAT;
    const filter = options.filter ?? (() => true);
    const rethrow = options.rethrow ?? false;
    return async (ctx, next) => {
        try {
            await next();
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            if (!filter(error)) {
                if (rethrow)
                    throw error;
                return;
            }
            logger?.error(`[error-handler] 捕获异常: ${error.stack ?? error.message}`);
            try {
                const reply = format(error, ctx);
                if (reply) {
                    await ctx.bot.sendMarkdown(ctx.replyTarget, reply);
                }
            }
            catch (sendErr) {
                // 回复失败不能再抛：兜底层的兜底，只记日志
                logger?.error(`[error-handler] 错误提示发送失败: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
            }
            if (rethrow)
                throw error;
            // 已经回过「处理异常」就必须结束这条链：否则集成方会把同一条消息再正常
            // 处理一遍（#39），用户先收到报错、紧接着又收到一条正常回答。
            ctx.skip('error:' + (error.name || 'Error'));
        }
    };
}
//# sourceMappingURL=error-handler.js.map
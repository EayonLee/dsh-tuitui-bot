/** 依次尝试两个通道；任一消费即返回其名字 */
async function tryChannels(channels, ctx, logger) {
    for (const { name, channel } of channels) {
        if (!channel.answerFromText)
            continue;
        try {
            if (await channel.answerFromText(ctx))
                return name;
        }
        catch (err) {
            // 解析失败不能让消息卡死：当成「没消费」，继续下一通道 / 正常链路
            logger?.warn(`[question-answer] ${name} 解析异常，继续往下走: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return null;
}
export function questionAnswer(manager, options = {}) {
    const log = options.logger;
    return async (ctx, next) => {
        const question = manager.questionChannel;
        const approval = manager.approvalChannel;
        if (!question?.answerFromText && !approval?.answerFromText) {
            await next();
            return;
        }
        const consumed = await tryChannels([
            { name: 'question-answer', channel: question ?? {} },
            { name: 'approval-answer', channel: approval ?? {} },
        ], ctx, log);
        if (consumed === 'question-answer') {
            log?.debug('[question-answer] 消息已被待答问题消费');
            ctx.state.answeredQuestion = true;
            ctx.skip('question-answer');
            return;
        }
        if (consumed === 'approval-answer') {
            log?.debug('[question-answer] 消息已被待批审批消费');
            // MiddlewareState 有索引签名，这里额外标注审批来源，便于入站侧排查
            ctx.state.answeredApproval = true;
            ctx.skip('approval-answer');
            return;
        }
        await next();
    };
}
//# sourceMappingURL=question-answer.js.map
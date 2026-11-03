/** 作用域标签：帖子要把团队/频道带上，否则模型不知道「这是哪个频道在说话」 */
function scopeLabel(ctx) {
    const msg = ctx.message;
    if (msg.kind === 'group')
        return `group(${msg.groupId ?? 'unknown'})`;
    if (msg.kind === 'post') {
        const team = msg.post?.teamName ?? msg.post?.teamId ?? 'unknown';
        const channel = msg.post?.channelName ?? msg.post?.channelId ?? 'unknown';
        return `post(${team}/${channel})`;
    }
    return 'c2c';
}
function buildEnvelope(ctx, options) {
    const sections = [];
    // ── 发送者与作用域 ──
    if (options.includeSender) {
        const name = ctx.message.senderName || ctx.message.senderAccount || ctx.message.senderId;
        sections.push(`<from>\nuser: ${name}\nscope: ${scopeLabel(ctx)}\n</from>`);
    }
    // ── 引用消息（回复目标） ──
    if (options.includeQuote) {
        const quote = ctx.state.quote;
        if (quote?.text) {
            const sender = quote.senderName ? `${quote.senderName}: ` : '';
            sections.push(`<reply_to>\n${sender}${quote.text}\n</reply_to>`);
        }
    }
    // ── 群/频道历史 ──
    const history = ctx.state.history;
    if (history && history.length > 0) {
        const recent = history.slice(-options.historyLimit);
        const lines = recent.map((entry) => {
            const name = entry.senderName || entry.senderId;
            // 历史里的一条可能很长（贴了报错栈），压到 200 字避免挤掉真正的问题
            return `${name}: ${entry.content.slice(0, 200)}`;
        });
        sections.push(`<history>\n${lines.join('\n')}\n</history>`);
    }
    // ── 当前消息 ──
    const content = (ctx.message.content ?? '').trim();
    const attachments = ctx.message.attachments ?? [];
    if (content || attachments.length > 0) {
        const parts = [];
        if (content)
            parts.push(content);
        for (const attachment of attachments) {
            const name = attachment.filename ?? attachment.kind;
            if (attachment.kind === 'image')
                parts.push(`[image: ${name}]`);
            else if (attachment.kind === 'voice') {
                parts.push(attachment.asrText ? `[voice: ${attachment.asrText}]` : '[voice]');
            }
            else if (attachment.kind === 'video')
                parts.push(`[video: ${name}]`);
            else
                parts.push(`[file: ${name}]`);
        }
        sections.push(`<message>\n${parts.join('\n')}\n</message>`);
    }
    return sections.join('\n\n');
}
export function envelopeFormatter(options = {}) {
    const historyLimit = options.historyLimit ?? 5;
    const includeQuote = options.includeQuote ?? true;
    const includeSender = options.includeSender ?? true;
    const log = options.logger;
    return async (ctx, next) => {
        if (options.format) {
            ctx.state.envelope = options.format(ctx);
        }
        else {
            ctx.state.envelope = buildEnvelope(ctx, { historyLimit, includeQuote, includeSender });
        }
        log?.debug(`[envelope] 组装 ${ctx.state.envelope.length} 字符`
            + `（sender=${includeSender}, quote=${includeQuote}, history=${ctx.state.history?.length ?? 0}/${historyLimit}）`);
        await next();
    };
}
//# sourceMappingURL=envelope-formatter.js.map
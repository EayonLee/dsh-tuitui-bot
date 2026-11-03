/**
 * 信封组装中间件 — 把前面各层攒下的上下文拼成模型一眼能读的结构
 *
 * 上游称这层为「last mile」：历史、引用、发送者身份到这一步都已经在
 * `ctx.state` 里了，本中间件把它们排版成带标签的文本块，入站组装直接取用。
 *
 * 为什么用 XML 风格的标签而不是自然语言：模型对 `<history>`/`<reply_to>`
 * 这种边界标记最不容易混淆，也不会把「历史里别人的话」误认成「现在对我说的话」。
 *
 * 中间件是可选的：想自己拼 prompt 的调用方直接读 `ctx.state.history` / `quote`。
 */
import type { Logger, Middleware, MiddlewareContext } from '../../types.ts';

export interface EnvelopeFormatterOptions {
  /** 最多带几条历史，默认 5 */
  historyLimit?: number;
  /** 是否带上引用块，默认 true */
  includeQuote?: boolean;
  /** 是否带上发送者/作用域信息，默认 true */
  includeSender?: boolean;
  /** 完全自定义的组装逻辑（返回最终字符串） */
  format?: (ctx: MiddlewareContext) => string;
  logger?: Logger;
}

/** 作用域标签：帖子要把团队/频道带上，否则模型不知道「这是哪个频道在说话」 */
function scopeLabel(ctx: MiddlewareContext): string {
  const msg = ctx.message;
  if (msg.kind === 'group') return `group(${msg.groupId ?? 'unknown'})`;
  if (msg.kind === 'post') {
    const team = msg.post?.teamName ?? msg.post?.teamId ?? 'unknown';
    const channel = msg.post?.channelName ?? msg.post?.channelId ?? 'unknown';
    return `post(${team}/${channel})`;
  }
  return 'c2c';
}

function buildEnvelope(ctx: MiddlewareContext, options: Required<Pick<EnvelopeFormatterOptions, 'historyLimit' | 'includeQuote' | 'includeSender'>>): string {
  const sections: string[] = [];

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
    const parts: string[] = [];
    if (content) parts.push(content);
    for (const attachment of attachments) {
      const name = attachment.filename ?? attachment.kind;
      if (attachment.kind === 'image') parts.push(`[image: ${name}]`);
      else if (attachment.kind === 'voice') {
        parts.push(attachment.asrText ? `[voice: ${attachment.asrText}]` : '[voice]');
      } else if (attachment.kind === 'video') parts.push(`[video: ${name}]`);
      else parts.push(`[file: ${name}]`);
    }
    sections.push(`<message>\n${parts.join('\n')}\n</message>`);
  }

  return sections.join('\n\n');
}

export function envelopeFormatter(options: EnvelopeFormatterOptions = {}): Middleware {
  const historyLimit = options.historyLimit ?? 5;
  const includeQuote = options.includeQuote ?? true;
  const includeSender = options.includeSender ?? true;
  const log = options.logger;

  return async (ctx, next) => {
    if (options.format) {
      ctx.state.envelope = options.format(ctx);
    } else {
      ctx.state.envelope = buildEnvelope(ctx, { historyLimit, includeQuote, includeSender });
    }

    log?.debug(
      `[envelope] 组装 ${ctx.state.envelope.length} 字符`
      + `（sender=${includeSender}, quote=${includeQuote}, history=${ctx.state.history?.length ?? 0}/${historyLimit}）`,
    );

    await next();
  };
}

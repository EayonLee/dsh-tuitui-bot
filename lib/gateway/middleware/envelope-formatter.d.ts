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
export declare function envelopeFormatter(options?: EnvelopeFormatterOptions): Middleware;
//# sourceMappingURL=envelope-formatter.d.ts.map
import { sendMarkdownChunked } from "../shared/index.js";
/**
 * 取命令参数。
 *
 * 优先用中间件解析好的 ctx.state.command（W2 的 slash-command 会写入）；拿不到
 * 时从正文里剥掉命令名——命令实现不绑定中间件内部细节，两种来源都能工作。
 */
export function commandArgs(ctx) {
    const parsed = ctx.state.command;
    if (parsed !== null && typeof parsed === 'object' && 'raw' in parsed) {
        const raw = parsed.raw;
        if (typeof raw === 'string')
            return raw.trim();
    }
    const content = ctx.message.content.trim();
    const match = /^[/!]\S+\s*([\s\S]*)$/.exec(content);
    return (match?.[1] ?? '').trim();
}
/** 统一回复：命令输出全部走分块发送（长表格/模型列表不会撞推推单条上限） */
export async function replyText(ctx, config, content) {
    await sendMarkdownChunked(ctx.bot, ctx.replyTarget, content, config.textChunkLimit);
}
//# sourceMappingURL=types.js.map
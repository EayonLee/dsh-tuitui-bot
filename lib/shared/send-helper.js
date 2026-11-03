import { chunkMarkdownText } from "../transport/chunker.js";
/** 分块发送 markdown（长内容自动切分） */
export async function sendMarkdownChunked(bot, target, content, chunkLimit) {
    const chunks = chunkMarkdownText(content, chunkLimit);
    for (const chunk of chunks) {
        await bot.sendMarkdown(target, chunk);
    }
}
//# sourceMappingURL=send-helper.js.map
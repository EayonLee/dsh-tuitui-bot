/**
 * 分块发送 markdown 工具
 *
 * 长内容自动按推推消息长度限制切分后逐条发送。
 */
import type { ReplyTarget, TuituiSender } from '../types.ts';
import { chunkMarkdownText } from '../transport/chunker.ts';

/** 分块发送 markdown（长内容自动切分） */
export async function sendMarkdownChunked(
  bot: TuituiSender,
  target: ReplyTarget,
  content: string,
  chunkLimit: number,
): Promise<void> {
  const chunks = chunkMarkdownText(content, chunkLimit);
  for (const chunk of chunks) {
    await bot.sendMarkdown(target, chunk);
  }
}

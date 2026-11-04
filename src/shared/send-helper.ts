/**
 * 分块发送 markdown 工具
 *
 * 长内容自动按推推消息长度限制切分后逐条发送。
 */
import type { ReplyTarget, TuituiSender } from '../types.ts';
import { chunkMarkdownText } from '../transport/chunker.ts';

/** 分块发送 markdown（长内容自动切分） */
/** 分片之间的间隔（毫秒）：给推送服务喘口气，避免 10503 */
const DEFAULT_CHUNK_GAP_MS = 250;

export async function sendMarkdownChunked(
  bot: TuituiSender,
  target: ReplyTarget,
  content: string,
  chunkLimit: number,
  /** 分片间隔，测试里传 0 */
  chunkGapMs: number = DEFAULT_CHUNK_GAP_MS,
): Promise<void> {
  const chunks = chunkMarkdownText(content, chunkLimit);
  for (const [index, chunk] of chunks.entries()) {
    await bot.sendMarkdown(target, chunk);
    // 切出来的多条消息别一股脑怼上去：推推对同目标的密集发送会回 errcode 10503，
    // 表现出来就是"模型答完了但群里没收到"。留一点间隔，比失败重试便宜。
    if (index < chunks.length - 1 && chunkGapMs > 0) {
      await new Promise<void>((resolve) => { setTimeout(resolve, chunkGapMs); });
    }
  }
}

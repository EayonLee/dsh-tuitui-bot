/**
 * 分块发送 markdown 工具
 *
 * 长内容自动按推推消息长度限制切分后逐条发送。
 */
import type { ReplyTarget, TuituiSender } from '../types.ts';
export declare function sendMarkdownChunked(bot: TuituiSender, target: ReplyTarget, content: string, chunkLimit: number, 
/** 分片间隔，测试里传 0 */
chunkGapMs?: number): Promise<void>;
//# sourceMappingURL=send-helper.d.ts.map
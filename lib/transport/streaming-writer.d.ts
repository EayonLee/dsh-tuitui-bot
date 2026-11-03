/**
 * StreamingWriter — 推推流式文本写入器
 *
 * 与上游（QQ）唯一的差别在传输层：流式会话由 `TuituiSender.openStream` 提供，
 * 内部是 `im.modifyText` 原地重写同一条消息；拿不到 msgid（团队帖子、
 * 群聊，或首条消息还没落地）时返回 null，此处必须优雅降级为静态发送。
 *
 * 边界条件设计：
 *   - 节流（throttle）：固定间隔 flush，避免每 token 发一次 HTTP，同时保证长文本分多次推送
 *   - 串行队列（chain）：保证 update 顺序，finish 前最后一次文本必达
 *   - 降级（sentChunkCount === 0）：只有从未成功发送分片才降级静态，
 *     避免"已流式部分 + 静态全量"的重复内容
 *   - 拿不到流式目标（openStream 返回 null）：与 openStream 抛错同等对待，
 *     只标记 failed 一次，绝不每帧重试
 *   - 终态幂等（finished）：finish/abort 后忽略 append，重复 finish 不重复 complete
 *   - 中止关闭（abort）：abort 时若 session 已打开，串行 complete 关闭，避免悬挂
 */
import type { Logger, ReplyTarget } from '../types.ts';
import type { OutboundSenderLike } from './outbound-buffer.ts';
export interface StreamingWriterDeps {
    bot: OutboundSenderLike;
    target: ReplyTarget;
    logger: Logger;
    /** 节流间隔（ms）：连续 append 累积后，停顿该间隔才 update */
    throttleMs: number;
}
export declare class StreamingWriter {
    private fullText;
    private session;
    private sentChunkCount;
    private failed;
    private finished;
    private aborted;
    private throttleTimer;
    private chain;
    private readonly deps;
    constructor(deps: StreamingWriterDeps);
    /** 是否应降级为静态发送：从未成功发送过任何分片 */
    get shouldFallback(): boolean;
    /** 累积全文（降级静态发送时使用） */
    get text(): string;
    /**
     * 重置累积文本（LLM 重试的新 attempt）。
     *
     * 保留已打开的流式会话与 sentChunkCount：推推 `im.modifyText` 同样是全量替换
     * 语义，新 attempt 的增量会把同一条消息整体重写，用户不会看到两条消息；
     * sentChunkCount 保留则防止重试后误判"从未发送"而降级静态造成重复。
     */
    reset(): void;
    /** 追加增量文本，节流（throttle）后 update 全量 */
    append(delta: string): void;
    /** 结束：flush 最终文本 + complete 收尾 */
    finish(): Promise<void>;
    /** 中止（异常/取消）：关闭已打开的流式会话，避免悬挂 */
    abort(): void;
    /** 入队一次 update（串行，保证顺序） */
    private enqueue;
    /** 推送当前累积文本（首次 openStream + update 全量） */
    private pushUpdate;
}
//# sourceMappingURL=streaming-writer.d.ts.map
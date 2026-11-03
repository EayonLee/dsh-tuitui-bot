/**
 * OutboundBuffer — 出站文本缓冲
 *
 * 收集流式 chunk，流式优先投递（StreamingWriter），降级为静态发送。
 * 独立文件便于单测。
 *
 * 只依赖发送器的 `{ sendMarkdown, openStream }` 结构子集：TuituiSender 天然满足，
 * 单测里做个两行假发送器即可，不必拉起整个推推客户端。
 */
import type { SessionRecord } from '../session/index.ts';
import type { Logger, ReplyTarget, StreamSessionLike } from '../types.ts';
/**
 * 推推发送接口（结构子集）
 *
 * openStream 返回 null 表示「当前目标拿不到 msgid，无法原地编辑」，
 * 由 StreamingWriter 判定为降级静态发送。
 */
export interface OutboundSenderLike {
    sendMarkdown(target: ReplyTarget, content: string, opts?: {
        keyboard?: unknown;
        at?: string[];
    }): Promise<unknown>;
    openStream(target: ReplyTarget): StreamSessionLike | null;
}
export declare class OutboundBuffer {
    private buffer;
    private flushing;
    private readonly writer;
    private readonly record;
    private readonly bot;
    private readonly limit;
    private readonly logger;
    constructor(record: SessionRecord, bot: OutboundSenderLike, limit: number, logger: Logger, streamingEnabled: boolean);
    /** 追加文本增量 */
    append(text: string): void;
    /** 获取当前累积文本 */
    get text(): string;
    /** 重置累积文本（LLM 重试的新 attempt），流式会话保留由全量 update 重写 */
    reset(): void;
    /** 发送所有累积文本：流式优先，降级静态 */
    flush(): Promise<void>;
    /** 取消（异常/丢弃），中止流式并清空缓冲 */
    cancel(): void;
}
//# sourceMappingURL=outbound-buffer.d.ts.map
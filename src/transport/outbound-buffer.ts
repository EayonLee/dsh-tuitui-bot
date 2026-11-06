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
import { chunkMarkdownText } from './chunker.ts';
import { StreamingWriter } from './streaming-writer.ts';

/** 流式输出节流间隔(ms)：连续 chunk 累积后停顿该间隔才推送 */
const STREAM_THROTTLE_MS = 200;

/** 单段发送的最大重试次数（不含首次）：失败多半是 5xx / 限流 / 网络抖动，重试一次就够 */
const SEND_RETRIES = 2;

/** 重试退避基数（ms）：500、1000 */
const RETRY_BACKOFF_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 推推发送接口（结构子集）
 *
 * openStream 返回 null 表示「当前目标拿不到 msgid，无法原地编辑」，
 * 由 StreamingWriter 判定为降级静态发送。
 */
export interface OutboundSenderLike {
  sendMarkdown(target: ReplyTarget, content: string, opts?: { keyboard?: unknown; at?: string[] }): Promise<unknown>;
  openStream(target: ReplyTarget): StreamSessionLike | null;
}

export class OutboundBuffer {
  private buffer = '';
  private flushing = false;
  private readonly writer: StreamingWriter | null;
  private readonly record: SessionRecord;
  private readonly bot: OutboundSenderLike;
  private readonly limit: number;
  private readonly logger: Logger;

  public constructor(
    record: SessionRecord,
    bot: OutboundSenderLike,
    limit: number,
    logger: Logger,
    streamingEnabled: boolean,
  ) {
    this.record = record;
    this.bot = bot;
    this.limit = limit;
    this.logger = logger;
    this.writer = streamingEnabled
      ? new StreamingWriter({ bot, target: record.replyTarget, logger, throttleMs: STREAM_THROTTLE_MS })
      : null;
  }

  /** 追加文本增量 */
  public append(text: string): void {
    this.buffer += text;
    this.writer?.append(text);
  }

  /** 获取当前累积文本 */
  public get text(): string {
    return this.buffer;
  }

  /** 重置累积文本（LLM 重试的新 attempt），流式会话保留由全量 update 重写 */
  public reset(): void {
    this.buffer = '';
    this.writer?.reset();
  }

  /** 发送所有累积文本：流式优先，降级静态 */
  public async flush(): Promise<void> {
    if (this.flushing || !this.buffer.trim()) return;
    this.flushing = true;

    try {
      if (this.writer) {
        await this.writer.finish();
        // 流式成功（未降级）→ 直接返回
        if (!this.writer.shouldFallback) return;
      }

      // 降级：静态发送（writer 不存在 or 流式失败）
      const chunks = chunkMarkdownText(this.buffer, this.limit);
      // 单段失败不能让后面几段一起沉默：逐段重试，最后统计失败的段数
      const failed: string[] = [];
      for (const chunk of chunks) {
        if (!(await this.sendChunk(chunk))) failed.push(chunk);
      }
      if (failed.length > 0) {
        const preview = failed[0]!.slice(0, 80).replace(/\s+/g, ' ');
        this.logger.error(
          `im-tuitui: ${failed.length}/${chunks.length} 段回复发送失败（首段预览：${preview}）`,
        );
        await this.notifyFailure(failed.length);
      }
    } catch (err) {
      this.logger.error(`im-tuitui: flush failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.buffer = '';
      this.flushing = false;
    }
  }

  /** 发一段，带有限重试；返回是否最终成功 */
  private async sendChunk(chunk: string): Promise<boolean> {
    for (let attempt = 0; attempt <= SEND_RETRIES; attempt += 1) {
      try {
        await this.bot.sendMarkdown(this.record.replyTarget, chunk);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt === SEND_RETRIES) {
          this.logger.error(`im-tuitui: 发送失败（已重试 ${SEND_RETRIES} 次）：${message}`);
          return false;
        }
        this.logger.warn(
          `im-tuitui: 发送失败，${RETRY_BACKOFF_MS * (attempt + 1)}ms 后重试（${attempt + 1}/${SEND_RETRIES}）：${message}`,
        );
        await delay(RETRY_BACKOFF_MS * (attempt + 1));
      }
    }
    return false;
  }

  /** 失败提示：发不出去也要让用户知道，而不是只留一行日志 */
  private async notifyFailure(count: number): Promise<void> {
    const notice = `⚠️ 有 ${count} 段回复没能发出去（网络或服务端异常），需要的话请再说一次。`;
    try {
      await this.bot.sendMarkdown(this.record.replyTarget, notice);
    } catch (err) {
      this.logger.error(`im-tuitui: 失败提示也没发出去：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 取消（异常/丢弃），中止流式并清空缓冲 */
  public cancel(): void {
    this.writer?.abort();
    this.buffer = '';
  }
}

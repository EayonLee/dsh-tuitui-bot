/**
 * 按「会话」串行化的发送队列。
 *
 * 为什么要队列：重试会把一条消息的发送拉长到几十秒，如果不串行，同一会话里
 * 后一条消息可能插到前一条的重试中间发出去——用户看到的顺序就乱了；分片长文本
 * 也会因为并发发送更容易撞上限流。
 *
 * 设计取舍（跟常见做法一致）：
 * - 同一个 key 串行，不同 key 并行（不要拿一把大锁把整个机器人都卡住）
 * - 每个 key 只允许有限条排队，超了就直接丢并留日志，避免会话卡死时队列无限堆积
 */
export interface SendQueueOptions {
  /** 单个会话最多排队多少条（不含正在发的那条） */
  maxPendingPerKey: number;
  /** 丢弃时的回调，用于记日志 */
  onDrop?: (key: string) => void;
}

export class SendQueue {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly pending = new Map<string, number>();

  public constructor(private readonly options: SendQueueOptions) {}

  /** 当前某会话排队中（含正在执行）的条数 */
  public size(key: string): number {
    return this.pending.get(key) ?? 0;
  }

  /**
   * 把任务排进 key 的队尾。
   *
   * 返回的 Promise 就是任务本身的结果：失败会原样抛给调用方，
   * 但不会影响队列里后面的任务。
   */
  public run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const queued = this.pending.get(key) ?? 0;
    if (queued > this.options.maxPendingPerKey) {
      this.options.onDrop?.(key);
      return Promise.reject(new SendQueueOverflowError(key, this.options.maxPendingPerKey));
    }
    this.pending.set(key, queued + 1);

    const previous = this.tails.get(key) ?? Promise.resolve();
    // 前一条失败不能把后一条带下水，所以这里固定用 resolved
    const current = previous.then(task, task);
    this.tails.set(key, current.catch(() => undefined));

    const cleanup = (): void => {
      const remaining = (this.pending.get(key) ?? 1) - 1;
      if (remaining <= 0) {
        this.pending.delete(key);
        this.tails.delete(key);
      } else {
        this.pending.set(key, remaining);
      }
    };
    void current.then(cleanup, cleanup);
    return current;
  }
}

export class SendQueueOverflowError extends Error {
  public readonly key: string;
  public readonly limit: number;

  public constructor(key: string, limit: number) {
    super(`发送队列已满（${key} 排队超过 ${String(limit)} 条），本条丢弃`);
    this.name = 'SendQueueOverflowError';
    this.key = key;
    this.limit = limit;
  }
}

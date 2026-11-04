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
export declare class SendQueue {
    private readonly options;
    private readonly tails;
    private readonly pending;
    constructor(options: SendQueueOptions);
    /** 当前某会话排队中（含正在执行）的条数 */
    size(key: string): number;
    /**
     * 把任务排进 key 的队尾。
     *
     * 返回的 Promise 就是任务本身的结果：失败会原样抛给调用方，
     * 但不会影响队列里后面的任务。
     */
    run<T>(key: string, task: () => Promise<T>): Promise<T>;
}
export declare class SendQueueOverflowError extends Error {
    readonly key: string;
    readonly limit: number;
    constructor(key: string, limit: number);
}
//# sourceMappingURL=send-queue.d.ts.map
/**
 * 出站节流守卫 — **语义改造，与上游不同**
 *
 * 上游 QQ Bot 的 ReplyLimiter 管理"被动回复限额"：同一条入站消息最多被动回复
 * 4 次、群聊 5 分钟后失效，超限必须降级为主动消息。推推没有这套被动回复模型
 * （referenceMessageId 只影响展示，不消耗额度），整块限额语义在这里失效。
 *
 * 但推推有自己的"不能刷屏"约束：流式被关闭或降级后，切分出的多个 chunk、
 * 工具结果、错误提示、交付物清单会在几百毫秒内连续发出七八条消息，客户端会
 * 把它们挤成一片并触发服务端频控。因此保留文件名与导出名，把语义换成出站
 * 节流守卫：
 *   1. 同一 target 的最小发送间隔（默认 300ms），保证消息按序、可读地下发；
 *   2. 相同内容的短时间去重（默认 2s），挡掉"重试 / 事件重放导致重复发送同一段"；
 *   3. 超限**排队而非丢弃**——这是与上游最关键的区别：上游额度耗尽只能降级
 *      通道（换一种发法），而节流等待只是延迟，把内容吞掉才是越权。
 */
export interface ReplyLimiterConfig {
    /** 同一 target 两次发送的最小间隔（ms，默认 300） */
    minIntervalMs?: number;
    /** 相同内容的去重窗口（ms，默认 2000） */
    dedupeWindowMs?: number;
    /** 最多跟踪多少 target（超出按插入顺序驱逐，默认 1000，防长期运行泄漏） */
    maxTrackedTargets?: number;
}
/** 一次发送判定结果 */
export interface ReplyLimitResult {
    /** 是否放行（false = 命中同内容去重窗口，本次不发） */
    allowed: boolean;
    /** 被去重或被节流时的原因（allowed=false 时必为 deduped） */
    reason?: 'deduped' | 'throttled';
    /** 距离可以发送还需等待的毫秒数（0 = 立即） */
    waitMs: number;
}
export declare class ReplyLimiter {
    private readonly minIntervalMs;
    private readonly dedupeWindowMs;
    private readonly maxTracked;
    private readonly targets;
    constructor(config?: ReplyLimiterConfig);
    /**
     * 纯查询：这次发送会被去重吗？需要等多久？
     *
     * 不改变任何状态——排队中的任务在真正执行前会重新查一次（见 run），
     * 因为排队期间同一 target 可能已经发出过相同内容。
     */
    check(targetKey: string, content: string): ReplyLimitResult;
    /** 记录一次真正落地的发送（外部直接发消息时也可手动记账） */
    record(targetKey: string, content?: string): void;
    /**
     * 排队发送：同 target 串行、按最小间隔节流、同内容短时间去重。
     *
     * 去重命中时返回 undefined（调用方据此知道"这次没发"，但不算失败）；
     * task 自身抛出的异常原样向上传递，交由调用方记录日志——发送失败不该让
     * 后续排队的消息全部沉默。
     */
    run<T>(targetKey: string, content: string, task: () => Promise<T>): Promise<T | undefined>;
    /** 取（或建）target 状态，超出上限时驱逐最早登记的那个 */
    private targetState;
}
//# sourceMappingURL=reply-limiter.d.ts.map
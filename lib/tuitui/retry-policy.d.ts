/**
 * 发送失败的重试策略。
 *
 * 参考了两处成熟做法：
 * - p-retry（sindresorhus）：指数退避 + `factor` / `minTimeout` / `maxTimeout`，
 *   并且"不可重试的错误直接 Abort"，不浪费次数。
 *   https://github.com/sindresorhus/p-retry
 * - AWS 架构博客的 Full Jitter：`sleep = random(0, min(cap, base * 2^attempt))`，
 *   把重试打散，避免一堆会话在同一时刻一起重试再次把服务打崩。
 *   https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 *
 * 推推的实际情况：`errcode 10503`（消息发送失败）绝大多数是瞬时故障或瞬时限流，
 * 隔几秒再来往往就好了；所以次数给足、间隔退避、总时长封顶，宁可慢一点也别丢回复。
 */
export interface RetryPolicy {
    /** 含首次发送在内，最多尝试次数 */
    attempts: number;
    minDelayMs: number;
    maxDelayMs: number;
    /** 指数因子 */
    factor: number;
    totalBudgetMs: number;
}
export declare const DEFAULT_SEND_RETRY: RetryPolicy;
/**
 * 这个错误值不值得重试。
 *
 * 参数错、密钥错、权限不足这类重试一百次也是同一个结果，直接放弃，
 * 别让用户白等 75 秒。
 */
export declare function isRetryableSendError(error: unknown): boolean;
/** 服务端给了 Retry-After（秒或 HTTP 日期）就照它的意思等 */
export declare function retryAfterMs(error: unknown): number | undefined;
/**
 * 第 `attempt` 次重试前该等多久（attempt 从 1 开始）。
 *
 * Full Jitter：上限 `min(maxDelay, minDelay * factor^(attempt-1))`，
 * 实际等待在这个上限里随机取，避免同一时刻一堆消息撞在一起重试。
 */
export declare function backoffDelayMs(attempt: number, policy?: RetryPolicy, rng?: () => number): number;
export interface RetryHooks {
    /** 每次重试前调用，便于记日志 */
    onRetry?: (info: {
        attempt: number;
        delayMs: number;
        error: unknown;
    }) => void;
    /** 可注入的等待与随机数，测试用 */
    sleep?: (ms: number) => Promise<void>;
    rng?: () => number;
    now?: () => number;
}
/**
 * 带退避的重试执行器。
 *
 * 三种"停"的条件：不可重试的错误、次数用完、总预算耗尽。
 */
export declare function withSendRetry<T>(run: () => Promise<T>, policy?: RetryPolicy, hooks?: RetryHooks): Promise<T>;
//# sourceMappingURL=retry-policy.d.ts.map
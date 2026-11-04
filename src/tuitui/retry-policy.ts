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

/** 一次发送最多试几次（含首发） */
const DEFAULT_ATTEMPTS = 6;
/** 首次重试的基准间隔 */
const DEFAULT_MIN_DELAY_MS = 500;
/** 单次重试的最长等待 */
const DEFAULT_MAX_DELAY_MS = 15_000;
/** 整个重试过程的总时间预算，超了就放弃（否则一条消息能挂好几分钟） */
const DEFAULT_TOTAL_BUDGET_MS = 75_000;

export interface RetryPolicy {
  /** 含首次发送在内，最多尝试次数 */
  attempts: number;
  minDelayMs: number;
  maxDelayMs: number;
  /** 指数因子 */
  factor: number;
  totalBudgetMs: number;
}

export const DEFAULT_SEND_RETRY: RetryPolicy = {
  attempts: DEFAULT_ATTEMPTS,
  minDelayMs: DEFAULT_MIN_DELAY_MS,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
  factor: 2,
  totalBudgetMs: DEFAULT_TOTAL_BUDGET_MS,
};

/** 推推里明确属于"再来一次可能就好了"的业务码 */
const RETRYABLE_ERRCODES = new Set([
  10503, // 消息发送失败（服务内部故障 / 瞬时限流）
  10001, // 系统繁忙
  10002, // 请求过于频繁
]);

/** 网络层错误的关键词（不同 Node 版本措辞略有差异） */
const NETWORK_ERROR_PATTERN = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|network error|other side closed/i;

/**
 * 这个错误值不值得重试。
 *
 * 参数错、密钥错、权限不足这类重试一百次也是同一个结果，直接放弃，
 * 别让用户白等 75 秒。
 */
export function isRetryableSendError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as Record<string, unknown>;

  const errcode = record.errcode;
  if (typeof errcode === 'number' && RETRYABLE_ERRCODES.has(errcode)) return true;

  const status = record.status;
  if (typeof status === 'number' && (status === 429 || status >= 500)) return true;

  const message = typeof record.message === 'string' ? record.message : '';
  return NETWORK_ERROR_PATTERN.test(message);
}

/** 服务端给了 Retry-After（秒或 HTTP 日期）就照它的意思等 */
export function retryAfterMs(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const record = error as Record<string, unknown>;

  const candidates = [record.retryAfter, (record.response as Record<string, unknown> | undefined)?.retry_after];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value <= 1000 ? value * 1000 : value;
    if (typeof value === 'string') {
      const asNumber = Number(value);
      if (Number.isFinite(asNumber) && asNumber >= 0) return asNumber * 1000;
      const asDate = Date.parse(value);
      if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
    }
  }
  return undefined;
}

/**
 * 第 `attempt` 次重试前该等多久（attempt 从 1 开始）。
 *
 * Full Jitter：上限 `min(maxDelay, minDelay * factor^(attempt-1))`，
 * 实际等待在这个上限里随机取，避免同一时刻一堆消息撞在一起重试。
 */
export function backoffDelayMs(attempt: number, policy: RetryPolicy = DEFAULT_SEND_RETRY, rng: () => number = Math.random): number {
  const exponential = policy.minDelayMs * Math.pow(policy.factor, Math.max(0, attempt - 1));
  const cap = Math.min(policy.maxDelayMs, exponential);
  return Math.round(rng() * cap);
}

export interface RetryHooks {
  /** 每次重试前调用，便于记日志 */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
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
export async function withSendRetry<T>(
  run: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_SEND_RETRY,
  hooks: RetryHooks = {},
): Promise<T> {
  const sleep = hooks.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const rng = hooks.rng ?? Math.random;
  const now = hooks.now ?? Date.now;
  const startedAt = now();

  let lastError: unknown;
  for (let attempt = 1; attempt <= Math.max(1, policy.attempts); attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const isLast = attempt >= policy.attempts;
      if (isLast || !isRetryableSendError(error)) break;

      const spent = now() - startedAt;
      if (spent >= policy.totalBudgetMs) break;

      const remainingBudgetMs = Math.max(0, policy.totalBudgetMs - spent);
      // 服务端明确说了多久之后再试，就听它的（只受总预算约束）；
      // 没说的话按退避 + 抖动来，且不超过单次上限。
      const suggestedMs = retryAfterMs(error);
      const delayMs = suggestedMs === undefined
        ? Math.min(backoffDelayMs(attempt, policy, rng), policy.maxDelayMs, remainingBudgetMs)
        : Math.min(suggestedMs, remainingBudgetMs);
      hooks.onRetry?.({ attempt, delayMs, error });
      if (delayMs > 0) await sleep(delayMs);
    }
  }
  throw lastError;
}

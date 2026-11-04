import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEND_RETRY,
  backoffDelayMs,
  isRetryableSendError,
  retryAfterMs,
  withSendRetry,
  type RetryPolicy,
} from './retry-policy.ts';

function apiError(errcode: number, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`errcode ${String(errcode)}`), { errcode, endpoint: '/message/custom/send', ...extra });
}

const FAST: RetryPolicy = { attempts: 4, minDelayMs: 1, maxDelayMs: 1, factor: 2, totalBudgetMs: 5_000 };

describe('isRetryableSendError', () => {
  it('10503 / 429 / 5xx 可重试', () => {
    expect(isRetryableSendError(apiError(10503))).toBe(true);
    expect(isRetryableSendError(apiError(1, { status: 429 }))).toBe(true);
    expect(isRetryableSendError(apiError(1, { status: 503 }))).toBe(true);
  });

  it('参数 / 权限 / 密钥错不重试', () => {
    expect(isRetryableSendError(apiError(1002, { status: 400 }))).toBe(false);
    expect(isRetryableSendError(new Error('Param Incorrect'))).toBe(false);
    expect(isRetryableSendError(new Error('鉴权失败'))).toBe(false);
    expect(isRetryableSendError(null)).toBe(false);
  });

  it('网络层错误可重试', () => {
    expect(isRetryableSendError(new Error('fetch failed'))).toBe(true);
    expect(isRetryableSendError(new Error('socket hang up'))).toBe(true);
    expect(isRetryableSendError(new Error('ECONNRESET'))).toBe(true);
  });
});

describe('backoffDelayMs（指数退避 + Full Jitter）', () => {
  it('第 n 次的上限按 factor 增长，且不超过 maxDelay', () => {
    const policy: RetryPolicy = { attempts: 10, minDelayMs: 500, maxDelayMs: 8_000, factor: 2, totalBudgetMs: 60_000 };
    expect(backoffDelayMs(1, policy, () => 1)).toBe(500);
    expect(backoffDelayMs(2, policy, () => 1)).toBe(1_000);
    expect(backoffDelayMs(5, policy, () => 1)).toBe(8_000);
    // 封顶之后不再增长
    expect(backoffDelayMs(9, policy, () => 1)).toBe(8_000);
  });

  it('实际等待在 [0, 上限] 内抖动，不会超过上限', () => {
    const policy: RetryPolicy = { attempts: 10, minDelayMs: 500, maxDelayMs: 4_000, factor: 2, totalBudgetMs: 60_000 };
    for (let i = 0; i < 50; i += 1) {
      const delay = backoffDelayMs(4, policy);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(4_000);
    }
  });
});

describe('retryAfterMs', () => {
  it('数字按秒解释（<=1000 当秒），HTTP 日期也能解析', () => {
    expect(retryAfterMs({ retryAfter: 3 })).toBe(3_000);
    expect(retryAfterMs({ response: { retry_after: 2 } })).toBe(2_000);
    const future = new Date(Date.now() + 5_000).toUTCString();
    const parsed = retryAfterMs({ retryAfter: future });
    expect(parsed).toBeDefined();
    expect(parsed as number).toBeGreaterThan(3_000);
  });

  it('没有这个头就返回 undefined', () => {
    expect(retryAfterMs(apiError(10503))).toBeUndefined();
  });
});

describe('withSendRetry', () => {
  it('首次就成功：不重试', async () => {
    let calls = 0;
    const result = await withSendRetry(async () => { calls += 1; return 'ok'; }, FAST);
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('可重试错误一直重到次数用完，抛最后一个错误', async () => {
    let calls = 0;
    const retries: number[] = [];
    await expect(withSendRetry(async () => {
      calls += 1;
      throw apiError(10503);
    }, FAST, { onRetry: (info) => retries.push(info.attempt), sleep: async () => {} })).rejects.toMatchObject({ errcode: 10503 });
    expect(calls).toBe(FAST.attempts);
    expect(retries).toEqual([1, 2, 3]);
  });

  it('中间成功就收手，不浪费次数', async () => {
    let calls = 0;
    const result = await withSendRetry(async () => {
      calls += 1;
      if (calls < 3) throw apiError(10503);
      return 'third-time-lucky';
    }, FAST, { sleep: async () => {} });
    expect(result).toBe('third-time-lucky');
    expect(calls).toBe(3);
  });

  it('不可重试的错误立刻放弃', async () => {
    let calls = 0;
    await expect(withSendRetry(async () => {
      calls += 1;
      throw apiError(1002, { status: 400 });
    }, FAST, { sleep: async () => {} })).rejects.toMatchObject({ errcode: 1002 });
    expect(calls).toBe(1);
  });

  it('总预算耗尽就停手，不会无限重试', async () => {
    let calls = 0;
    let clock = 0;
    await expect(withSendRetry(async () => {
      calls += 1;
      clock += 400;
      throw apiError(10503);
    }, { ...FAST, totalBudgetMs: 1_000 }, {
      sleep: async () => {},
      now: () => clock,
      rng: () => 1,
    })).rejects.toBeDefined();
    expect(calls).toBeLessThanOrEqual(4);
  });

  it('服务端给了 Retry-After 就按它的时间等', async () => {
    const delays: number[] = [];
    let calls = 0;
    await expect(withSendRetry(async () => {
      calls += 1;
      throw apiError(10503, { retryAfter: 2 });
    }, { ...FAST, attempts: 2 }, {
      onRetry: (info) => delays.push(info.delayMs),
      sleep: async () => {},
    })).rejects.toBeDefined();
    expect(calls).toBe(2);
    expect(delays).toEqual([2_000]);
  });

  it('默认策略：6 次尝试、总预算 75 秒', () => {
    expect(DEFAULT_SEND_RETRY.attempts).toBe(6);
    expect(DEFAULT_SEND_RETRY.totalBudgetMs).toBe(75_000);
  });
});

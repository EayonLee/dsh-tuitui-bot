import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReplyLimiter } from './reply-limiter.ts';

/**
 * ReplyLimiter 的语义是出站节流 / 去重守卫，因此用例分四组：
 * 节流、去重、排队与容错（设计说明见 reply-limiter.ts 文件头）。
 */
describe('ReplyLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('首次发送立即执行，不做等待', async () => {
    const limiter = new ReplyLimiter();
    const task = vi.fn().mockResolvedValue('ok');

    const result = await limiter.run('c2c:u1', 'hello', task);

    expect(result).toBe('ok');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('同一 target 连发两次时第二次排到最小间隔之后', async () => {
    const limiter = new ReplyLimiter({ minIntervalMs: 300 });
    const order: string[] = [];

    const first = limiter.run('c2c:u1', 'a', async () => {
      order.push('a');
    });
    const second = limiter.run('c2c:u1', 'b', async () => {
      order.push('b');
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['a']); // 第二条还在排队
    await first;

    await vi.advanceTimersByTimeAsync(299);
    expect(order).toEqual(['a']);

    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(order).toEqual(['a', 'b']); // 顺序保持
  });

  it('不同 target 互不影响，各自立即发送', async () => {
    const limiter = new ReplyLimiter({ minIntervalMs: 300 });
    const taskA = vi.fn().mockResolvedValue('a');
    const taskB = vi.fn().mockResolvedValue('b');

    await limiter.run('c2c:u1', 'x', taskA);
    await limiter.run('c2c:u2', 'x', taskB);

    expect(taskA).toHaveBeenCalledTimes(1);
    expect(taskB).toHaveBeenCalledTimes(1);
  });

  it('相同内容在去重窗口内被跳过（返回 undefined，不调用 task）', async () => {
    const limiter = new ReplyLimiter({ minIntervalMs: 0, dedupeWindowMs: 2000 });
    const task = vi.fn().mockResolvedValue('sent');

    await limiter.run('c2c:u1', 'same', task);
    const skipped = await limiter.run('c2c:u1', 'same', task);

    expect(skipped).toBeUndefined();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('相同内容超过去重窗口后可以再次发送', async () => {
    const limiter = new ReplyLimiter({ minIntervalMs: 0, dedupeWindowMs: 2000 });
    const task = vi.fn().mockResolvedValue('sent');

    await limiter.run('c2c:u1', 'same', task);
    await vi.advanceTimersByTimeAsync(2001);
    await limiter.run('c2c:u1', 'same', task);

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('不同内容不受去重影响', async () => {
    const limiter = new ReplyLimiter({ minIntervalMs: 0 });
    const task = vi.fn().mockResolvedValue('sent');

    await limiter.run('c2c:u1', 'a', task);
    await limiter.run('c2c:u1', 'b', task);

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('check 是纯查询：不改变状态', () => {
    const limiter = new ReplyLimiter({ minIntervalMs: 300 });

    expect(limiter.check('c2c:u1', 'x')).toEqual({ allowed: true, waitMs: 0 });

    limiter.record('c2c:u1', 'x');

    const decision = limiter.check('c2c:u1', 'y');
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('throttled');
    expect(decision.waitMs).toBeGreaterThan(0);
    // 再查一次结果相同（没有因为查询而"消费"掉节流窗口）
    expect(limiter.check('c2c:u1', 'y').waitMs).toBe(decision.waitMs);
  });

  it('去重命中时 check 返回 deduped', () => {
    const limiter = new ReplyLimiter({ dedupeWindowMs: 2000 });
    limiter.record('c2c:u1', 'same');

    expect(limiter.check('c2c:u1', 'same')).toEqual({ allowed: false, reason: 'deduped', waitMs: 0 });
  });

  it('task 抛错向调用方传递，但不毒化后续排队', async () => {
    const limiter = new ReplyLimiter({ minIntervalMs: 0 });
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    const ok = vi.fn().mockResolvedValue('ok');

    await expect(limiter.run('c2c:u1', 'bad', failing)).rejects.toThrow('boom');
    await expect(limiter.run('c2c:u1', 'good', ok)).resolves.toBe('ok');
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('跟踪的 target 数量达上限时驱逐最早登记的那个', async () => {
    const limiter = new ReplyLimiter({ minIntervalMs: 300, maxTrackedTargets: 2 });
    const noop = async (): Promise<void> => {};

    await limiter.run('c2c:u1', 'a', noop);
    await limiter.run('c2c:u2', 'b', noop);
    await limiter.run('c2c:u3', 'c', noop); // u1 被驱逐

    // u3 受节流窗口约束（刚发过）；u1 已无状态，立即可发
    expect(limiter.check('c2c:u3', 'd').waitMs).toBeGreaterThan(0);
    expect(limiter.check('c2c:u1', 'd').waitMs).toBe(0);
  });
});

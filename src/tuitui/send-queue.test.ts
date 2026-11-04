import { describe, expect, it, vi } from 'vitest';
import { SendQueue, SendQueueOverflowError } from './send-queue.ts';

/** 让出一次事件循环，便于观察执行顺序 */
const tick = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

describe('SendQueue（同一会话串行，不同会话并行）', () => {
  it('同一个 key 严格按入队顺序执行', async () => {
    const queue = new SendQueue({ maxPendingPerKey: 10 });
    const order: string[] = [];

    const tasks = ['a', 'b', 'c'].map((name) => queue.run('group:1', async () => {
      await tick();
      order.push(name);
      return name;
    }));

    await Promise.all(tasks);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('同一 key 不会并发执行', async () => {
    const queue = new SendQueue({ maxPendingPerKey: 10 });
    let running = 0;
    let maxRunning = 0;

    await Promise.all([1, 2, 3, 4].map(() => queue.run('group:1', async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await tick();
      running -= 1;
    })));

    expect(maxRunning).toBe(1);
  });

  it('不同 key 并行，不会被彼此拖住', async () => {
    const queue = new SendQueue({ maxPendingPerKey: 10 });
    const started: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const slow = queue.run('group:slow', async () => {
      started.push('slow');
      await gate;
    });
    const fast = queue.run('group:fast', async () => {
      started.push('fast');
      return 'fast-done';
    });

    await expect(fast).resolves.toBe('fast-done');
    expect(started).toEqual(['slow', 'fast']);
    release?.();
    await slow;
  });

  it('前一条失败不影响后一条', async () => {
    const queue = new SendQueue({ maxPendingPerKey: 10 });
    const failed = queue.run('c2c:u1', async () => { throw new Error('boom'); });
    const ok = queue.run('c2c:u1', async () => 'ok');

    await expect(failed).rejects.toThrow('boom');
    await expect(ok).resolves.toBe('ok');
  });

  it('排队超限就丢弃并回调，避免会话卡死时无限堆积', async () => {
    const onDrop = vi.fn();
    const queue = new SendQueue({ maxPendingPerKey: 1, onDrop });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const first = queue.run('group:x', async () => { await gate; });
    const second = queue.run('group:x', async () => 'second');
    const third = queue.run('group:x', async () => 'third');

    await expect(third).rejects.toBeInstanceOf(SendQueueOverflowError);
    expect(onDrop).toHaveBeenCalledWith('group:x');

    release?.();
    await first;
    await expect(second).resolves.toBe('second');
  });

  it('队列跑空后能继续接新任务（不残留尾巴）', async () => {
    const queue = new SendQueue({ maxPendingPerKey: 5 });
    await queue.run('group:x', async () => 'one');
    await queue.run('group:x', async () => 'two');
    expect(queue.size('group:x')).toBe(0);
  });
});

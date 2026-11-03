import { afterEach, describe, expect, it, vi } from 'vitest';
import { concurrencyGuard } from './concurrency-guard.ts';
import { createGate, makeCtx, makeMessage, runMiddleware } from './test-utils.ts';
import type { Middleware } from '../../types.ts';

afterEach(() => {
  vi.useRealTimers();
});

/** 记录每次下游执行的标记，便于断言串行 / 合并行为 */
function makeRecorder() {
  const calls: string[] = [];
  const handlerFor = (label: string) => async (): Promise<void> => {
    calls.push(label);
  };
  return { calls, handlerFor };
}

describe('concurrencyGuard', () => {
  it('空闲目标立即处理，不缓冲', async () => {
    const guard = concurrencyGuard({ strategy: 'merge' });
    const { calls, handlerFor } = makeRecorder();

    await guard(makeCtx(makeMessage({ messageId: 'a' })), handlerFor('a'));
    expect(calls).toEqual(['a']);
  });

  it('merge：忙时缓冲，owner 完成后合并成一条继续', async () => {
    const guard = concurrencyGuard({ strategy: 'merge', maxQueue: 10 });
    const gate = createGate();
    const calls: string[] = [];

    const a = makeCtx(makeMessage({ messageId: 'a', content: '第一句' }));
    const b = makeCtx(makeMessage({ messageId: 'b', content: '第二句' }));
    const c = makeCtx(makeMessage({ messageId: 'c', content: '第三句' }));

    const runA = guard(a, async () => {
      calls.push('a-enter');
      await gate.wait;
      calls.push('a-exit');
    });
    const runB = guard(b, async () => {
      calls.push('b:' + b.message.content);
    });
    const runC = guard(c, async () => {
      calls.push('c:' + c.message.content);
    });

    // B、C 都还挂在缓冲里，没有进入下游
    expect(calls).toEqual(['a-enter']);

    gate.open();
    await Promise.all([runA, runB, runC]);

    // 合并后只跑一条：幸存者是批次里的第一条，正文是两句话拼起来的
    expect(calls).toEqual(['a-enter', 'a-exit', 'b:第二句\n第三句']);
    expect(c.skipped).toBeUndefined();
  });

  it('merge：缓冲超过 maxQueue 时丢弃并 skip', async () => {
    const guard = concurrencyGuard({ strategy: 'merge', maxQueue: 1 });
    const gate = createGate();
    const calls: string[] = [];

    const runA = guard(makeCtx(makeMessage({ messageId: 'a' })), async () => {
      await gate.wait;
    });
    const runB = guard(makeCtx(makeMessage({ messageId: 'b' })), async () => {
      calls.push('b');
    });
    const c = makeCtx(makeMessage({ messageId: 'c' }));
    const runC = guard(c, async () => {
      calls.push('c');
    });

    gate.open();
    await Promise.all([runA, runB, runC]);

    expect(c.skipped).toBe('concurrency:merge-full');
    expect(calls).toEqual(['b']);
  });

  it('merge：紧急消息清空缓冲并立刻并行处理', async () => {
    const guard = concurrencyGuard({
      strategy: 'merge',
      maxQueue: 10,
      urgentPredicate: (ctx) => ctx.message.content === '/stop',
    });
    const gate = createGate();
    const calls: string[] = [];

    const runA = guard(makeCtx(makeMessage({ messageId: 'a' })), async () => {
      await gate.wait;
    });
    const runB = guard(makeCtx(makeMessage({ messageId: 'b', content: '普通消息' })), async () => {
      calls.push('b');
    });
    const runUrgent = guard(makeCtx(makeMessage({ messageId: 'u', content: '/stop' })), async () => {
      calls.push('urgent');
    });

    await runUrgent;
    expect(calls).toEqual(['urgent']);

    gate.open();
    await Promise.all([runA, runB]);

    // 缓冲已被紧急消息清空，普通消息不会再被合并执行
    expect(calls).toEqual(['urgent']);
  });

  it('queue：后到的消息等前一条结束后串行执行', async () => {
    const guard = concurrencyGuard({ strategy: 'queue', maxQueue: 5 });
    const gate = createGate();
    const calls: string[] = [];

    const runA = guard(makeCtx(makeMessage({ messageId: 'a' })), async () => {
      calls.push('a-enter');
      await gate.wait;
      calls.push('a-exit');
    });
    const runB = guard(makeCtx(makeMessage({ messageId: 'b' })), async () => {
      calls.push('b');
    });

    await Promise.resolve();
    expect(calls).toEqual(['a-enter']);

    gate.open();
    await Promise.all([runA, runB]);
    expect(calls).toEqual(['a-enter', 'a-exit', 'b']);
  });

  it('queue：队列满时丢弃并回调 onDrop', async () => {
    const dropped: string[] = [];
    const guard = concurrencyGuard({
      strategy: 'queue',
      maxQueue: 1,
      onDrop: (ctx) => {
        dropped.push(ctx.message.messageId);
      },
    });
    const gate = createGate();

    const runA = guard(makeCtx(makeMessage({ messageId: 'a' })), async () => {
      await gate.wait;
    });
    const runB = guard(makeCtx(makeMessage({ messageId: 'b' })), async () => {
      // 唯一一个排队名额，正常等到 A 结束
    });

    const c = makeCtx(makeMessage({ messageId: 'c' }));
    const runC = guard(c, async () => undefined);

    gate.open();
    await Promise.all([runA, runB, runC]);

    expect(c.skipped).toBe('concurrency:queue-full');
    expect(dropped).toEqual(['c']);
  });

  it('drop：忙时静默丢弃并回调 onDrop', async () => {
    const guard = concurrencyGuard({ strategy: 'drop', onDrop: () => dropped.push('1') });
    const dropped: string[] = [];
    const gate = createGate();

    const runA = guard(makeCtx(makeMessage({ messageId: 'a' })), async () => {
      await gate.wait;
    });
    const b = makeCtx(makeMessage({ messageId: 'b' }));
    await runMiddleware(guard, b);

    expect(b.skipped).toBe('concurrency:drop');
    expect(dropped).toEqual(['1']);

    gate.open();
    await runA;
  });

  it('maxProcessingMs 超时：中断当前处理、回调 onInterrupt、放行后一条', async () => {
    vi.useFakeTimers();
    const interrupts: string[] = [];
    const guard = concurrencyGuard({
      strategy: 'merge',
      maxQueue: 5,
      maxProcessingMs: 1_000,
      onInterrupt: (_ctx, reason) => {
        interrupts.push(reason);
      },
    });

    const a = makeCtx(makeMessage({ messageId: 'a' }));
    const runA = guard(a, async () => {
      // 模拟一篇永远返回不了的模型调用
      await new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(interrupts).toEqual(['concurrency:timeout']);
    expect(a.skipped).toBe('concurrency:timeout');

    await vi.advanceTimersByTimeAsync(10_000);
    await runA;
  });

  it('不同 target 之间互不阻塞', async () => {
    const guard = concurrencyGuard({ strategy: 'merge' });
    const gate = createGate();
    const calls: string[] = [];

    const groupCtx = makeCtx(makeMessage({ messageId: 'a', kind: 'group', groupId: 'g1' }));
    const c2cCtx = makeCtx(makeMessage({ messageId: 'b', kind: 'c2c', senderId: 'u2' }));

    const runGroup = guard(groupCtx, async () => {
      calls.push('group-enter');
      await gate.wait;
    });
    const runC2c = guard(c2cCtx, async () => {
      calls.push('c2c');
    });

    await runC2c;
    expect(calls).toEqual(['group-enter', 'c2c']);

    gate.open();
    await runGroup;
  });
});

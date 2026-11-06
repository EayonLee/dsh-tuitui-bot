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

describe('strategyFor（按作用域分开）', () => {
  it('群聊走 queue、私聊走 abort：同一时刻两条消息不会被合并', async () => {
    const guard = concurrencyGuard({
      strategy: 'merge',
      strategyFor: (ctx) => (ctx.message.kind === 'c2c' ? 'abort' : 'queue'),
    });
    const gate = createGate();
    const calls: string[] = [];

    const groupCtx = makeCtx(makeMessage({ messageId: 'g1', groupId: 'g-1' }));
    const runGroup = guard(groupCtx, async () => {
      calls.push('group-enter');
      await gate.wait;
      calls.push('group-exit');
    });

    // 群里再来一条：排队，不会立刻进下游
    const groupCtx2 = makeCtx(makeMessage({ messageId: 'g2', groupId: 'g-1', content: '第二条' }));
    const runGroup2 = guard(groupCtx2, async () => { calls.push('group-2'); });
    await Promise.resolve();
    expect(calls).toEqual(['group-enter']);

    gate.open();
    await Promise.all([runGroup, runGroup2]);
    expect(calls).toEqual(['group-enter', 'group-exit', 'group-2']);
  });

  it('私聊用 abort 时，正在跑的那条会被 skip 掉', async () => {
    const guard = concurrencyGuard({ strategyFor: () => 'abort' });
    const gate = createGate();
    const interrupts: string[] = [];

    const first = makeCtx(makeMessage({ kind: 'c2c', eventType: 'c2c_chat', messageId: 'c1', senderId: 'u1' }));
    const runFirst = guard(first, async () => { await gate.wait; });
    await Promise.resolve();

    const second = makeCtx(makeMessage({ kind: 'c2c', eventType: 'c2c_chat', messageId: 'c2', senderId: 'u1' }));
    const runSecond = guard(second, async () => { interrupts.push('second-ran'); });
    await Promise.resolve();

    expect(first.skipped).toBe('concurrency:abort');
    gate.open();
    await Promise.all([runFirst, runSecond]);
    expect(interrupts).toEqual(['second-ran']);
  });
});

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
    // 非幸存者正文已并入 b，必须明确 skip：否则 bootstrap 会把 c 再处理一遍（#35）
    expect(c.skipped).toBe('concurrency:merged');
  });

  it('merge：锁随幸存者交接，第三条不会与它并发（#39）', async () => {
    const guard = concurrencyGuard({ strategy: 'merge', maxQueue: 10 });
    const gate = createGate();
    const calls: string[] = [];

    const a = makeCtx(makeMessage({ messageId: 'a', content: '第一句' }));
    const b = makeCtx(makeMessage({ messageId: 'b', content: '第二句' }));
    const runA = guard(a, async () => {
      calls.push('a-enter');
      await gate.wait;
      calls.push('a-exit');
    });
    const runB = guard(b, async () => {
      calls.push('b-enter');
      await gate.wait;
      calls.push('b-exit');
    });

    gate.open();
    await Promise.all([runA, runB]);
    expect(calls).toEqual(['a-enter', 'a-exit', 'b-enter', 'b-exit']);

    // 幸存者 B 跑完之后的第三条：正常排队、串行执行
    const d = makeCtx(makeMessage({ messageId: 'd', content: '第四条' }));
    await guard(d, async () => {
      calls.push('d-enter');
      calls.push('d-exit');
    });
    expect(calls.slice(-2)).toEqual(['d-enter', 'd-exit']);
  });

  it('merge：幸存者还在跑时插进来的消息必须等它退出（不并发）', async () => {
    const guard = concurrencyGuard({ strategy: 'merge', maxQueue: 10 });
    const gate = createGate();
    const survivorGate = createGate();
    const events: string[] = [];

    const a = makeCtx(makeMessage({ messageId: 'a', content: '第一句' }));
    const b = makeCtx(makeMessage({ messageId: 'b', content: '第二句' }));
    const runA = guard(a, async () => { events.push('a'); await gate.wait; });
    const runB = guard(b, async () => {
      events.push('b-enter');
      await survivorGate.wait;   // 幸存者故意拖住
      events.push('b-exit');
    });

    gate.open();
    // 交接要经过 owner 收尾 + 微任务调度，用宏任务 flush 一次拿到稳定状态
    await new Promise((resolve) => setTimeout(resolve, 0));
    // 此刻 B 已接手并卡在 survivorGate 上
    expect(events).toContain('b-enter');

    const late = makeCtx(makeMessage({ messageId: 'late', content: '后来的' }));
    const runLate = guard(late, async () => { events.push('late'); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).not.toContain('late');

    survivorGate.open();
    await Promise.all([runA, runB, runLate]);
    expect(events).toEqual(['a', 'b-enter', 'b-exit', 'late']);
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

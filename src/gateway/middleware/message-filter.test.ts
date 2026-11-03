import { describe, expect, it } from 'vitest';
import { messageFilter } from './message-filter.ts';
import { makeCtx, makeMessage, runMiddleware } from './test-utils.ts';

describe('messageFilter', () => {
  it('默认丢弃机器人自回声消息', async () => {
    const ctx = makeCtx(makeMessage({ fromBot: true }));
    const { reachedNext } = await runMiddleware(messageFilter(), ctx);

    expect(reachedNext).toBe(false);
    expect(ctx.skipped).toBe('self-echo');
  });

  it('skipSelfEcho=false 时放行机器人消息', async () => {
    const ctx = makeCtx(makeMessage({ fromBot: true }));
    const { reachedNext } = await runMiddleware(messageFilter({ skipSelfEcho: false }), ctx);

    expect(reachedNext).toBe(true);
    expect(ctx.skipped).toBeUndefined();
  });

  it('窗口内同一 msgid 只处理一次', async () => {
    let now = 1_000;
    const filter = messageFilter({ dedup: { windowMs: 5_000, now: () => now } });

    const first = makeCtx(makeMessage({ messageId: 'dup-1' }));
    expect((await runMiddleware(filter, first)).reachedNext).toBe(true);

    const second = makeCtx(makeMessage({ messageId: 'dup-1' }));
    const result = await runMiddleware(filter, second);
    expect(result.reachedNext).toBe(false);
    expect(second.skipped).toBe('dedup');
  });

  it('窗口结束后同一 msgid 视为新消息', async () => {
    let now = 1_000;
    const filter = messageFilter({ dedup: { windowMs: 5_000, now: () => now } });

    await runMiddleware(filter, makeCtx(makeMessage({ messageId: 'dup-2' })));

    now += 5_001;
    const later = makeCtx(makeMessage({ messageId: 'dup-2' }));
    expect((await runMiddleware(filter, later)).reachedNext).toBe(true);
    expect(later.skipped).toBeUndefined();
  });

  it('dedup=false 时不去重', async () => {
    const filter = messageFilter({ dedup: false });
    await runMiddleware(filter, makeCtx(makeMessage({ messageId: 'same' })));

    const second = makeCtx(makeMessage({ messageId: 'same' }));
    expect((await runMiddleware(filter, second)).reachedNext).toBe(true);
  });

  it('缓存超容量时淘汰最老记录（被淘汰的 msgid 视为新消息）', async () => {
    let now = 1_000;
    const filter = messageFilter({ dedup: { windowMs: 1_000_000, maxSize: 2, now: () => now } });

    await runMiddleware(filter, makeCtx(makeMessage({ messageId: 'a' })));
    now += 1;
    await runMiddleware(filter, makeCtx(makeMessage({ messageId: 'b' })));
    now += 1;
    // 触发一次超容量淘汰（此时 a 应被清掉）
    await runMiddleware(filter, makeCtx(makeMessage({ messageId: 'c' })));

    // a 已被淘汰 → 再次出现按新消息处理（缓存容量有界，这是刻意的取舍）
    const replayA = makeCtx(makeMessage({ messageId: 'a' }));
    expect((await runMiddleware(filter, replayA)).reachedNext).toBe(true);

    // 最新的 c 仍在缓存里 → 仍然去重
    const replayC = makeCtx(makeMessage({ messageId: 'c' }));
    expect((await runMiddleware(filter, replayC)).reachedNext).toBe(false);
    expect(replayC.skipped).toBe('dedup');
  });
});

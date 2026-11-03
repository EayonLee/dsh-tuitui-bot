import { describe, expect, it } from 'vitest';
import { rateLimiter } from './rate-limiter.ts';
import type { RateLimitTierName } from './rate-limiter.ts';
import { makeCtx, makeMessage, runMiddleware } from './test-utils.ts';

describe('rateLimiter', () => {
  it('发送者超过窗口额度后跳过，reason=rate', async () => {
    let now = 0;
    const limiter = rateLimiter({
      perSender: { max: 3, windowMs: 60_000 },
      perGroup: false,
      global: false,
      now: () => now,
    });

    for (let i = 0; i < 3; i += 1) {
      const ctx = makeCtx(makeMessage({ messageId: 'm' + i }));
      expect((await runMiddleware(limiter, ctx)).reachedNext).toBe(true);
    }

    const blocked = makeCtx(makeMessage({ messageId: 'm-4' }));
    const { reachedNext } = await runMiddleware(limiter, blocked);
    expect(reachedNext).toBe(false);
    expect(blocked.skipped).toBe('rate');
  });

  it('窗口结束后自动恢复额度', async () => {
    let now = 0;
    const limiter = rateLimiter({
      perSender: { max: 2, windowMs: 1_000 },
      perGroup: false,
      global: false,
      now: () => now,
    });

    await runMiddleware(limiter, makeCtx(makeMessage({ messageId: 'a' })));
    await runMiddleware(limiter, makeCtx(makeMessage({ messageId: 'b' })));

    const blocked = makeCtx(makeMessage({ messageId: 'c' }));
    expect((await runMiddleware(limiter, blocked)).reachedNext).toBe(false);

    // 窗口滑过去后，旧记录被淘汰，额度恢复
    now += 1_001;
    const recovered = makeCtx(makeMessage({ messageId: 'd' }));
    expect((await runMiddleware(limiter, recovered)).reachedNext).toBe(true);
  });

  it('群维度按 groupId 独立计数', async () => {
    const limiter = rateLimiter({
      perSender: false,
      global: false,
      perGroup: { max: 1, windowMs: 60_000 },
    });

    expect((await runMiddleware(limiter, makeCtx(makeMessage({ groupId: 'g1' })))).reachedNext)
      .toBe(true);
    expect((await runMiddleware(limiter, makeCtx(makeMessage({ groupId: 'g2' })))).reachedNext)
      .toBe(true);

    const blocked = makeCtx(makeMessage({ groupId: 'g1' }));
    expect((await runMiddleware(limiter, blocked)).reachedNext).toBe(false);
    expect(blocked.skipped).toBe('rate');
  });

  it('全局维度跨群生效', async () => {
    const limiter = rateLimiter({
      perSender: false,
      perGroup: false,
      global: { max: 2, windowMs: 60_000 },
    });

    await runMiddleware(limiter, makeCtx(makeMessage({ groupId: 'g1' })));
    await runMiddleware(limiter, makeCtx(makeMessage({ groupId: 'g2' })));

    const blocked = makeCtx(makeMessage({ groupId: 'g3' }));
    expect((await runMiddleware(limiter, blocked)).reachedNext).toBe(false);
  });

  it('超限时回调 onLimit 带层级名', async () => {
    const tiers: RateLimitTierName[] = [];
    const limiter = rateLimiter({
      perSender: { max: 1, windowMs: 60_000 },
      perGroup: false,
      global: false,
      onLimit: (_ctx, tier) => {
        tiers.push(tier);
      },
    });

    await runMiddleware(limiter, makeCtx(makeMessage({ messageId: 'x1' })));
    await runMiddleware(limiter, makeCtx(makeMessage({ messageId: 'x2' })));

    expect(tiers).toEqual(['perSender']);
  });

  it('三层全部关闭时完全放行', async () => {
    const limiter = rateLimiter({ perSender: false, perGroup: false, global: false });
    for (let i = 0; i < 50; i += 1) {
      const ctx = makeCtx(makeMessage({ messageId: 'n' + i }));
      expect((await runMiddleware(limiter, ctx)).reachedNext).toBe(true);
    }
  });
});

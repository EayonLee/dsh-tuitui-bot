import { describe, it, expect } from 'vitest';
import { receiptReactions } from './typing-indicator.ts';
import { makeBot, makeCtx, makeMessage, runMiddleware } from './test-utils.ts';

/** 记录所有表情调用 */
function recorder(): { calls: string[]; bot: ReturnType<typeof makeBot> } {
  const calls: string[] = [];
  const bot = makeBot({
    emojiReaction: async (_target, _msgId, emoji, cancel) => {
      calls.push((cancel === true ? '-' : '+') + emoji);
    },
  });
  return { calls, bot };
}

describe('receiptReactions', () => {
  it('单聊：先挂「在算」，处理完撤掉并换成「好了」', async () => {
    const { calls, bot } = recorder();
    const ctx = makeCtx(makeMessage({ kind: 'c2c', eventType: 'c2c_chat' }), bot);
    await runMiddleware(receiptReactions({ ack: '👀', done: '✅' }), ctx);
    expect(calls).toEqual(['+👀', '-👀', '+✅']);
  });

  it('群聊默认也给回执', async () => {
    const { calls, bot } = recorder();
    const ctx = makeCtx(makeMessage(), bot);
    await runMiddleware(receiptReactions({ ack: '👀', done: '✅' }), ctx);
    expect(calls).toEqual(['+👀', '-👀', '+✅']);
  });

  it('群聊关掉后不挂任何表情', async () => {
    const { calls, bot } = recorder();
    const ctx = makeCtx(makeMessage(), bot);
    await runMiddleware(receiptReactions({ inGroup: false }), ctx);
    expect(calls).toEqual([]);
  });

  it('总开关关掉时什么都不做，下游照常', async () => {
    const { calls, bot } = recorder();
    const ctx = makeCtx(makeMessage({ kind: 'c2c', eventType: 'c2c_chat' }), bot);
    const result = await runMiddleware(receiptReactions({ enabled: false }), ctx);
    expect(calls).toEqual([]);
    expect(result.reachedNext).toBe(true);
  });

  it('处理抛错时换成「出错」并把异常继续抛给外层', async () => {
    const { calls, bot } = recorder();
    const ctx = makeCtx(makeMessage({ kind: 'c2c', eventType: 'c2c_chat' }), bot);
    const middleware = receiptReactions({ ack: '👀', done: '✅', fail: '😵' });
    await expect(middleware(ctx, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(calls).toEqual(['+👀', '-👀', '+😵']);
  });

  it('done / fail 留空时只撤不换', async () => {
    const { calls, bot } = recorder();
    const ctx = makeCtx(makeMessage({ kind: 'c2c', eventType: 'c2c_chat' }), bot);
    await runMiddleware(receiptReactions({ ack: '👀', done: '', fail: '' }), ctx);
    expect(calls).toEqual(['+👀', '-👀']);
  });

  it('表情接口失败不影响消息处理', async () => {
    const bot = makeBot({ emojiReaction: async () => { throw new Error('no permission'); } });
    const ctx = makeCtx(makeMessage({ kind: 'c2c', eventType: 'c2c_chat' }), bot);
    const result = await runMiddleware(receiptReactions(), ctx);
    expect(result.reachedNext).toBe(true);
  });
});

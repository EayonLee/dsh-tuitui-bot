import { describe, it, expect } from 'vitest';
import { receiptReactions } from './typing-indicator.ts';
import { makeBot, makeCtx, makeMessage, runMiddleware } from './test-utils.ts';
import { hasReceipt, resetReceipts, settleReceipt } from '../../features/receipt-registry.ts';

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

describe('receiptReactions 中间件', () => {
  it('收到消息只挂「在算」，换表情交给真正发消息那一步', async () => {
    resetReceipts();
    const { calls, bot } = recorder();
    const ctx = makeCtx(makeMessage({ kind: 'c2c', eventType: 'c2c_chat' }), bot);
    await runMiddleware(receiptReactions({ ack: '👀', done: '✅' }), ctx);
    expect(calls).toEqual(['+👀']);
    expect(hasReceipt(ctx.replyTarget, 'msg-1')).toBe(true);
  });

  it('登记之后兑现：撤掉「在算」，换成「好了」', async () => {
    resetReceipts();
    const { calls, bot } = recorder();
    const ctx = makeCtx(makeMessage({ kind: 'c2c', eventType: 'c2c_chat' }), bot);
    await runMiddleware(receiptReactions({ ack: '👀', done: '✅' }), ctx);
    await settleReceipt(ctx.replyTarget, 'done', 'msg-1');
    expect(calls).toEqual(['+👀', '-👀', '+✅']);
  });

  it('群聊默认也给回执', async () => {
    resetReceipts();
    const { calls, bot } = recorder();
    const ctx = makeCtx(makeMessage(), bot);
    await runMiddleware(receiptReactions({ ack: '👀', done: '✅' }), ctx);
    expect(calls).toEqual(['+👀']);
    expect(hasReceipt(ctx.replyTarget, 'msg-1')).toBe(true);
  });

  it('群聊关掉后不挂任何表情，也不留待兑现记录', async () => {
    resetReceipts();
    const { calls, bot } = recorder();
    const ctx = makeCtx(makeMessage(), bot);
    await runMiddleware(receiptReactions({ inGroup: false }), ctx);
    expect(calls).toEqual([]);
    expect(hasReceipt(ctx.replyTarget, 'msg-1')).toBe(false);
  });

  it('总开关关掉时什么都不做，下游照常', async () => {
    resetReceipts();
    const { calls, bot } = recorder();
    const ctx = makeCtx(makeMessage({ kind: 'c2c', eventType: 'c2c_chat' }), bot);
    const result = await runMiddleware(receiptReactions({ enabled: false }), ctx);
    expect(calls).toEqual([]);
    expect(result.reachedNext).toBe(true);
  });

  it('下游抛错时异常继续往外抛，回执不会卡在「在算」（由收尾兑现）', async () => {
    resetReceipts();
    const { calls, bot } = recorder();
    const ctx = makeCtx(makeMessage({ kind: 'c2c', eventType: 'c2c_chat' }), bot);
    const middleware = receiptReactions({ ack: '👀', done: '✅', fail: '😵' });
    await expect(middleware(ctx, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(calls).toEqual(['+👀']);
    await settleReceipt(ctx.replyTarget, 'fail', 'msg-1');
    expect(calls).toEqual(['+👀', '-👀', '+😵']);
  });

  it('表情接口失败不影响消息处理', async () => {
    resetReceipts();
    const bot = makeBot({ emojiReaction: async () => { throw new Error('no permission'); } });
    const ctx = makeCtx(makeMessage({ kind: 'c2c', eventType: 'c2c_chat' }), bot);
    const result = await runMiddleware(receiptReactions(), ctx);
    expect(result.reachedNext).toBe(true);
  });
});

  it('帖子也给回执（#48）', async () => {
    resetReceipts();
    const { calls, bot } = recorder();
    const ctx = makeCtx(makeMessage({ kind: 'post', eventType: 'post_chat', messageId: 'post-1' }), bot);
    await runMiddleware(receiptReactions({ ack: '👀', done: '✅' }), ctx);
    expect(calls).toEqual(['+👀']);
  });

  it('帖子也受 inGroup 开关约束（#48）', async () => {
    resetReceipts();
    const { calls, bot } = recorder();
    const ctx = makeCtx(makeMessage({ kind: 'post', eventType: 'post_chat', messageId: 'post-2' }), bot);
    await runMiddleware(receiptReactions({ inGroup: false }), ctx);
    expect(calls).toEqual([]);
  });
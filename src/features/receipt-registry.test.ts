import { describe, it, expect } from 'vitest';
import { hasReceipt, registerReceipt, resetReceipts, settleReceipt } from './receipt-registry.ts';
import type { ReplyTarget, TuituiSender } from '../types.ts';

const target: ReplyTarget = { scope: 'c2c', targetId: 'zhangsan', msgId: 'm-1' };

function fakeBot(calls: string[]): TuituiSender {
  return {
    sendMarkdown: async () => ({}),
    openStream: () => null,
    sendInteractive: async () => ({}),
    modifyInteractive: async () => undefined,
    sendImage: async () => ({}),
    sendFile: async () => ({}),
    recall: async () => undefined,
    emojiReaction: async (_t, _id, emoji, cancel) => {
      calls.push((cancel === true ? '-' : '+') + emoji);
    },
  };
}

function setup(done = '✅', fail = '😵') {
  resetReceipts();
  const calls: string[] = [];
  registerReceipt({ bot: fakeBot(calls), target, msgId: 'm-1', done, fail });
  return calls;
}

describe('receipt-registry', () => {
  it('done：撤掉在算再挂好了', async () => {
    const calls = setup();
    await settleReceipt(target, 'done', 'm-1');
    expect(calls).toEqual(['-👀', '+✅']);
    expect(hasReceipt(target, 'm-1')).toBe(false);
  });

  it('fail：换成出错', async () => {
    const calls = setup();
    await settleReceipt(target, 'fail', 'm-1');
    expect(calls).toEqual(['-👀', '+😵']);
  });

  it('none：只撤不换（这一轮不说话）', async () => {
    const calls = setup();
    await settleReceipt(target, 'none', 'm-1');
    expect(calls).toEqual(['-👀']);
  });

  it('done 配空串时只撤不换', async () => {
    const calls = setup('');
    await settleReceipt(target, 'done', 'm-1');
    expect(calls).toEqual(['-👀']);
  });

  it('重复兑现只做一次', async () => {
    const calls = setup();
    await settleReceipt(target, 'done', 'm-1');
    await settleReceipt(target, 'done', 'm-1');
    expect(calls).toEqual(['-👀', '+✅']);
  });

  it('不给 msgid 时按会话找最近一条', async () => {
    const calls = setup();
    await settleReceipt(target, 'done');
    expect(calls).toEqual(['-👀', '+✅']);
  });

  it('没有登记就什么都不做', async () => {
    resetReceipts();
    const calls: string[] = [];
    await settleReceipt({ scope: 'group', targetId: 'g-9' }, 'done', 'nope');
    expect(calls).toEqual([]);
  });

  it('表情接口炸了不往外抛', async () => {
    resetReceipts();
    registerReceipt({
      bot: { ...fakeBot([]), emojiReaction: async () => { throw new Error('no perm'); } },
      target,
      msgId: 'm-1',
      done: '✅',
      fail: '😵',
    });
    await expect(settleReceipt(target, 'done', 'm-1')).resolves.toBeUndefined();
    expect(hasReceipt(target, 'm-1')).toBe(false);
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ReplyLimiter } from './reply-limiter.ts';
import { cacheMsgId, cacheEventId } from './msgid-cache.ts';
import {
  resolveReplyTarget,
  resolveToTarget,
  sendResolvedMarkdown,
  sendThrottledMarkdown,
} from './reply-target.ts';
import type { ReplyTarget } from '../types.ts';

function makeTarget(msgId?: string, targetId = 'peer-1'): ReplyTarget {
  return { scope: 'c2c', targetId, msgId };
}

function makeSender(): { sendMarkdown: ReturnType<typeof vi.fn> } {
  return { sendMarkdown: vi.fn().mockResolvedValue({ msgId: 'sent-1' }) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveToTarget', () => {
  it('单聊域账号 → accounts', () => {
    expect(resolveToTarget({ scope: 'c2c', targetId: 'zhangsan' })).toEqual({ accounts: ['zhangsan'] });
  });

  it('单聊纯数字 id → uids（uid 目标不支持 modifyText）', () => {
    expect(resolveToTarget({ scope: 'c2c', targetId: '10086' })).toEqual({ uids: ['10086'] });
  });

  it('群聊 → groupId', () => {
    expect(resolveToTarget({ scope: 'group', targetId: 'g-1' })).toEqual({ groupId: 'g-1' });
  });

  it('团队帖子没有 im 目标 → null（由调用方走 teams）', () => {
    expect(resolveToTarget({ scope: 'post', targetId: 'ch-1', teamId: 't-1', channelId: 'ch-1' })).toBeNull();
  });
});

describe('resolveReplyTarget', () => {
  it('显式 msgId 仍在缓存窗口内 → 保留为引用目标', () => {
    cacheMsgId('c2c', 'peer-1', 'm1');
    const result = resolveReplyTarget(makeTarget('m1'));
    expect(result.msgId).toBe('m1');
  });

  it('显式 msgId 不在窗口内 → 退到最近一条入站 msgId', () => {
    cacheMsgId('c2c', 'peer-2', 'cached-1');
    const result = resolveReplyTarget(makeTarget('unknown-msg', 'peer-2'));
    expect(result.msgId).toBe('cached-1');
  });

  it('显式 msgId 超出 TTL → 退到新鲜候选', () => {
    vi.useFakeTimers();
    cacheMsgId('c2c', 'peer-10', 'stale-id');
    vi.setSystemTime(Date.now() + 31 * 60 * 1000); // c2c TTL 30min 过期
    cacheMsgId('c2c', 'peer-10', 'fresh-id'); // 窗口过期后用户又发了一条

    expect(resolveReplyTarget(makeTarget('stale-id', 'peer-10')).msgId).toBe('fresh-id');
  });

  it('没有任何候选 → 不引用，直接发送', () => {
    vi.useFakeTimers();
    cacheMsgId('c2c', 'peer-11', 'stale-id');
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    expect(resolveReplyTarget(makeTarget('stale-id', 'peer-11')).msgId).toBeUndefined();
  });

  it('allowReference=false（文件/卡片发送）→ 不引用', () => {
    cacheMsgId('c2c', 'peer-3', 'm-cached');
    const result = resolveReplyTarget(makeTarget('m-cached', 'peer-3'), { allowReference: false });
    expect(result.msgId).toBeUndefined();
  });

  it('交互回调事件不会被当作可引用消息', () => {
    cacheEventId('c2c', 'peer-4', 'evt-1');
    expect(resolveReplyTarget(makeTarget(undefined, 'peer-4')).msgId).toBeUndefined();
  });

  it('帖子目标归一化 channelId，msgId 取 postId（回复挂讨论串）', () => {
    const target: ReplyTarget = {
      scope: 'post',
      targetId: 'ch-1',
      teamId: 't-1',
      channelId: 'ch-1',
      postId: 'p-9',
      parentPostId: 'p-1',
    };
    const result = resolveReplyTarget(target);
    expect(result.channelId).toBe('ch-1');
    expect(result.msgId).toBe('p-9');
    expect(result.parentPostId).toBe('p-1');
  });

  it('帖子目标缺 channelId 时从 targetId 补齐', () => {
    const result = resolveReplyTarget({ scope: 'post', targetId: 'ch-2', teamId: 't-1', postId: 'p-2' });
    expect(result.channelId).toBe('ch-2');
  });
});

describe('sendResolvedMarkdown', () => {
  it('用解析后的引用目标发送 markdown', async () => {
    const sender = makeSender();
    cacheMsgId('c2c', 'peer-5', 'm-5');

    const result = await sendResolvedMarkdown(sender, makeTarget(undefined, 'peer-5'), 'hello');

    expect(sender.sendMarkdown).toHaveBeenCalledWith(
      { scope: 'c2c', targetId: 'peer-5', msgId: 'm-5' },
      'hello',
      undefined,
    );
    expect(result).toEqual({ msgId: 'sent-1' });
  });
});

describe('sendThrottledMarkdown', () => {
  it('节流守卫把发送串行化，同内容第二次被去重（返回空结果）', async () => {
    const sender = makeSender();
    const limiter = new ReplyLimiter({ minIntervalMs: 0, dedupeWindowMs: 2000 });
    const target: ReplyTarget = { scope: 'c2c', targetId: 'peer-6' };

    const first = await sendThrottledMarkdown(sender, target, 'same', undefined, limiter);
    const second = await sendThrottledMarkdown(sender, target, 'same', undefined, limiter);

    expect(sender.sendMarkdown).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ msgId: 'sent-1' });
    expect(second).toEqual({}); // 去重命中：没有 msgId，但不算失败
  });
});

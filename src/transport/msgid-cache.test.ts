import { describe, it, expect, vi, afterEach } from 'vitest';
import { cacheMsgId, cacheEventId, getCachedReplyIds, getMsgId } from './msgid-cache.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('msgid-cache', () => {
  it('caches and returns the most recent msgId', () => {
    cacheMsgId('c2c', 'u-cache-1', 'm1');
    cacheMsgId('c2c', 'u-cache-1', 'm2');
    expect(getCachedReplyIds('c2c', 'u-cache-1')).toEqual([
      { kind: 'msg', id: 'm2' },
      { kind: 'msg', id: 'm1' },
    ]);
  });

  it('distinguishes msg and event kinds', () => {
    cacheMsgId('c2c', 'u-cache-2', 'm1');
    cacheEventId('c2c', 'u-cache-2', 'evt1');
    expect(getCachedReplyIds('c2c', 'u-cache-2')).toEqual([
      { kind: 'event', id: 'INTERACTION_ACTION:evt1' },
      { kind: 'msg', id: 'm1' },
    ]);
  });

  it('isolates by target', () => {
    cacheMsgId('c2c', 'u-cache-3', 'ma');
    cacheMsgId('c2c', 'u-cache-4', 'mb');
    expect(getCachedReplyIds('c2c', 'u-cache-3')).toEqual([{ kind: 'msg', id: 'ma' }]);
    expect(getCachedReplyIds('c2c', 'u-cache-4')).toEqual([{ kind: 'msg', id: 'mb' }]);
  });

  it('isolates by scope（同 id 在群聊与单聊互不串台）', () => {
    cacheMsgId('group', 'same-id', 'g1');
    cacheMsgId('c2c', 'same-id', 'c1');
    expect(getMsgId('group', 'same-id')).toBe('g1');
    expect(getMsgId('c2c', 'same-id')).toBe('c1');
  });

  it('returns empty for an unknown target', () => {
    expect(getCachedReplyIds('c2c', 'u-nonexistent')).toEqual([]);
  });

  it('returns multiple cached ids in reverse chronological order', () => {
    cacheMsgId('c2c', 'u-cache-5', 'm1');
    cacheMsgId('c2c', 'u-cache-5', 'm2');
    cacheMsgId('c2c', 'u-cache-5', 'm3');
    expect(getCachedReplyIds('c2c', 'u-cache-5')).toEqual([
      { kind: 'msg', id: 'm3' },
      { kind: 'msg', id: 'm2' },
      { kind: 'msg', id: 'm1' },
    ]);
  });

  it('expires group messages after 5 minutes', () => {
    vi.useFakeTimers();
    cacheMsgId('group', 'g-cache-1', 'mg1');
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(getCachedReplyIds('group', 'g-cache-1')).toEqual([]);
  });

  it('expires c2c messages after 30 minutes', () => {
    vi.useFakeTimers();
    cacheMsgId('c2c', 'u-cache-expire', 'm-old');
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    expect(getCachedReplyIds('c2c', 'u-cache-expire')).toEqual([]);
  });

  it('ignores empty ids', () => {
    cacheMsgId('c2c', 'u-cache-empty', '');
    cacheMsgId('c2c', 'u-cache-empty', undefined);
    expect(getCachedReplyIds('c2c', 'u-cache-empty')).toEqual([]);
  });

  it('getMsgId 跳过交互回调事件，只返回可引用的消息 id', () => {
    cacheMsgId('c2c', 'u-cache-6', 'real-msg');
    cacheEventId('c2c', 'u-cache-6', 'evt-9');
    expect(getMsgId('c2c', 'u-cache-6')).toBe('real-msg');
  });

  it('getMsgId 在只有交互回调时返回 undefined（不引用事件）', () => {
    cacheEventId('c2c', 'u-cache-7', 'evt-only');
    expect(getMsgId('c2c', 'u-cache-7')).toBeUndefined();
  });
});

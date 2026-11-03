import { describe, expect, it, vi } from 'vitest';
import { IdleEvictor } from './idle-evictor.ts';
import type { SessionRecord } from './types.ts';

function makeRecord(status: string, lastActivity: number): SessionRecord {
  return {
    sessionKey: 'tuitui:group:g1',
    sessionId: 's1',
    agent: { status } as SessionRecord['agent'],
    handle: { dispose: () => Promise.resolve() } as unknown as SessionRecord['handle'],
    replyTarget: { scope: 'group', targetId: 'g1' },
    scope: 'group',
    peerId: 'g1',
    senderId: 'u1',
    lastActivity,
  };
}

describe('IdleEvictor', () => {
  it('超时且空闲的会话会被回收', () => {
    const sessions = new Map<string, SessionRecord>();
    sessions.set('k1', makeRecord('idle', Date.now() - 10 * 60_000));
    const onEvict = vi.fn();
    const evictor = new IdleEvictor(sessions, 5 * 60_000, onEvict);

    evictor.check();
    evictor.dispose();

    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict.mock.calls[0]?.[0]).toBe('k1');
  });

  it('正在跑的一轮即使超时也不回收（长任务保护）', () => {
    const sessions = new Map<string, SessionRecord>();
    sessions.set('k1', makeRecord('running', Date.now() - 10 * 60_000));
    const onEvict = vi.fn();
    const evictor = new IdleEvictor(sessions, 5 * 60_000, onEvict);

    evictor.check();
    evictor.dispose();

    expect(onEvict).not.toHaveBeenCalled();
  });

  it('未超时的会话不回收', () => {
    const sessions = new Map<string, SessionRecord>();
    sessions.set('k1', makeRecord('idle', Date.now()));
    const onEvict = vi.fn();
    const evictor = new IdleEvictor(sessions, 5 * 60_000, onEvict);

    evictor.check();
    evictor.dispose();

    expect(onEvict).not.toHaveBeenCalled();
  });

  it('timeout=0 时不启动定时器', () => {
    const sessions = new Map<string, SessionRecord>();
    const onEvict = vi.fn();
    const evictor = new IdleEvictor(sessions, 0, onEvict);
    evictor.dispose();
    expect(onEvict).not.toHaveBeenCalled();
  });
});

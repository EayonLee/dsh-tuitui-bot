import { describe, it, expect, vi } from 'vitest';
import { describeGroupEvent, recordGroupEvent } from './group-events.ts';
import { MemoryHistoryStore } from '../features/history-store.ts';

describe('describeGroupEvent', () => {
  it('认出被拉进群，带群名和群号', () => {
    const out = describeGroupEvent('group_invite', { group_id: 'g-1', group_name: '测试群' });
    expect(out).toEqual({ groupId: 'g-1', text: '[系统] 我被拉进了这个群：测试群' });
  });

  it('建群和踢人都能识别', () => {
    expect(describeGroupEvent('group_create', { groupId: 'g-2' })?.groupId).toBe('g-2');
    expect(describeGroupEvent('group_kick', { data: { chat_id: 'g-3' } })?.groupId).toBe('g-3');
  });

  it('普通消息事件不算群事件', () => {
    expect(describeGroupEvent('group_chat', { group_id: 'g-1' })).toBeUndefined();
  });

  it('拿不到群号也要给出文字', () => {
    expect(describeGroupEvent('group_invite', {})).toEqual({ text: '[系统] 我被拉进了这个群' });
  });
});

describe('recordGroupEvent', () => {
  it('写进判定历史存储', () => {
    const store = new MemoryHistoryStore();
    const logger = { warn: vi.fn() } as never;
    recordGroupEvent(store, 'g-1', { groupId: 'g-1', text: '[系统] 我被拉进了这个群' }, logger);
    expect(store.list('g-1', 10).map((e) => e.content)).toEqual(['[系统] 我被拉进了这个群']);
  });

  it('存储抛错只记 warn，不往外炸', () => {
    const store = { append: () => { throw new Error('boom'); } };
    const warn = vi.fn();
    recordGroupEvent(store as never, 'g-1', { text: 'x' }, { warn } as never);
    expect(warn).toHaveBeenCalled();
  });
});

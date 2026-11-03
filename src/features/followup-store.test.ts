import { describe, it, expect, beforeEach } from 'vitest';
import { markBotReply, isLikelyFollowUp, clearFollowUps } from './followup-store.ts';

describe('followup-store', () => {
  beforeEach(() => {
    clearFollowUps();
  });

  it('没有记录时不算追问', () => {
    expect(isLikelyFollowUp('group', 'g1', 'u1', 60_000)).toBe(false);
  });

  it('窗口内同一个人继续发消息算追问', () => {
    markBotReply('group', 'g1', 'u1', 1_000);
    expect(isLikelyFollowUp('group', 'g1', 'u1', 60_000, 11_000)).toBe(true);
  });

  it('窗口过期不算追问', () => {
    markBotReply('group', 'g1', 'u1', 1_000);
    expect(isLikelyFollowUp('group', 'g1', 'u1', 5_000, 61_000)).toBe(false);
  });

  it('换人说话不算追问（避免抢答别人的问题）', () => {
    markBotReply('group', 'g1', 'u1', 1_000);
    expect(isLikelyFollowUp('group', 'g1', 'u2', 60_000, 2_000)).toBe(false);
  });

  it('不同会话互不影响', () => {
    markBotReply('group', 'g1', 'u1', 1_000);
    expect(isLikelyFollowUp('group', 'g2', 'u1', 60_000, 2_000)).toBe(false);
    expect(isLikelyFollowUp('c2c', 'u1', 'u1', 60_000, 2_000)).toBe(false);
  });

  it('peerId 为空时不写记录', () => {
    markBotReply('group', '', 'u1', 1_000);
    expect(isLikelyFollowUp('group', '', 'u1', 60_000, 2_000)).toBe(false);
  });
});

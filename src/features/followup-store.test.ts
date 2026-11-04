import { describe, it, expect, beforeEach } from 'vitest';
import { markBotReply, clearFollowUp, clearFollowUps } from './followup-store.ts';

describe('followup-store', () => {
  beforeEach(() => {
    clearFollowUps();
  });

  it('记录与清除都不抛错', () => {
    markBotReply('group', 'g1', 'u1', 1_000);
    clearFollowUp('group', 'g1');
    markBotReply('group', '', 'u1', 1_000); // peerId 为空时不写，也不该炸
    expect(true).toBe(true);
  });
});

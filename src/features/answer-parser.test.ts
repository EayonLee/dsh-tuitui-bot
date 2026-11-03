import { describe, it, expect } from 'vitest';
import { APPROVAL_OPTIONS, parseAnswer, parseApprovalDecision } from './answer-parser.ts';
import type { UserQuestion } from './question-channel.ts';

const q2 = (): UserQuestion => ({ id: 'q', question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }] });

describe('parseAnswer', () => {
  it('accepts full-width separators and dupes', () => {
    const q: UserQuestion = {
      id: 'q',
      question: 't',
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
      multiSelect: true,
    };
    expect(parseAnswer(q, '1，3、3')).toEqual({ id: 'q', selected: ['A', 'C'] });
  });

  it('matches option labels case-insensitively', () => {
    const q: UserQuestion = { id: 'q', question: 't', options: [{ label: 'Yes' }, { label: 'No' }] };
    expect(parseAnswer(q, 'yes')).toEqual({ id: 'q', selected: ['Yes'] });
  });

  it('single-select takes only the first number', () => {
    expect(parseAnswer(q2(), '1 2')).toEqual({ id: 'q', selected: ['A'] });
  });
});

describe('parseApprovalDecision（推推的文本兜底：卡片不可用时用编号/词作答）', () => {
  it('maps the numbered options from the fallback prompt', () => {
    expect(parseApprovalDecision('1')).toBe('allow');
    expect(parseApprovalDecision('2')).toBe('deny');
  });

  it('accepts common words (case-insensitive)', () => {
    expect(parseApprovalDecision('同意')).toBe('allow');
    expect(parseApprovalDecision('  允许 ')).toBe('allow');
    expect(parseApprovalDecision('OK')).toBe('allow');
    expect(parseApprovalDecision('拒绝')).toBe('deny');
    expect(parseApprovalDecision('No')).toBe('deny');
  });

  it('returns undefined for anything that is not a decision', () => {
    // 审批挂起期间用户完全可能聊别的，不能被误当拒绝
    expect(parseApprovalDecision('')).toBeUndefined();
    expect(parseApprovalDecision('顺便看下磁盘')).toBeUndefined();
    expect(parseApprovalDecision('3')).toBeUndefined();
    expect(parseApprovalDecision('/status')).toBeUndefined();
  });

  it('option list stays 1=allow / 2=deny（与纯文本提示一致）', () => {
    expect(APPROVAL_OPTIONS.map((o) => o.key)).toEqual(['allow', 'deny']);
    expect(parseApprovalDecision('1')).toBe(APPROVAL_OPTIONS[0]?.key);
    expect(parseApprovalDecision('2')).toBe(APPROVAL_OPTIONS[1]?.key);
  });
});

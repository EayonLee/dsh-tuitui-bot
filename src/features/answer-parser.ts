/**
 * 文本回复 → 结构化答案（纯函数，便于单测）。
 *
 * 逐题解析：一次解析一个问题的答案。
 *
 * 推推的交互卡片在帖子里不可用、卡片发送失败或用户直接打字时，都要靠这里兜底，
 * 因此除问答外还提供审批决策的文本解析（上游没有这段：QQ 审批必须有按钮）。
 */
import type { UserQuestion, UserQuestionAnswer } from './question-channel.ts';

/** 把用户对单个问题的文本回复解析为答案 */
export function parseAnswer(question: UserQuestion, text: string): UserQuestionAnswer {
  const opts = question.options ?? [];
  if (opts.length > 0) {
    // 纯数字/分隔符 → 按编号选择
    if (/^[\d\s,，、;；./]+$/.test(text)) {
      const nums = [...text.matchAll(/\d+/g)]
        .map((m) => parseInt(m[0], 10))
        .filter((n) => n >= 1 && n <= opts.length);
      if (nums.length > 0) {
        const picked = question.multiSelect ? nums : nums.slice(0, 1);
        const selected = [...new Set(picked.map((n) => opts[n - 1]?.label).filter((l): l is string => typeof l === 'string'))];
        return { id: question.id, selected };
      }
    }
    // 文本与某个选项 label 完全一致（忽略大小写）
    const exact = opts.find((o) => o.label.toLowerCase() === text.toLowerCase());
    if (exact) return { id: question.id, selected: [exact.label] };
  }
  return { id: question.id, selected: [], custom: text };
}

/** 审批的肯定/否定词表（小写匹配，覆盖常见口语写法） */
const APPROVE_WORDS = new Set([
  '1', 'y', 'yes', 'ok', 'allow', '同意', '允许', '允许一次', '确认', '可以', '好',
]);
const REJECT_WORDS = new Set([
  '2', 'n', 'no', 'deny', 'reject', '拒绝', '不同意', '不允许', '否决', '不行',
]);

/**
 * 审批的文本兜底：解析用户回复的决策。
 *
 * 返回 undefined 表示"这句话不是审批决策"，调用方必须继续走常规消息流程——
 * 审批挂起期间用户完全可能聊别的，不能把任意消息当成拒绝。
 */
export function parseApprovalDecision(text: string): 'allow' | 'deny' | undefined {
  const s = text.trim().toLowerCase();
  if (!s) return undefined;
  if (APPROVE_WORDS.has(s)) return 'allow';
  if (REJECT_WORDS.has(s)) return 'deny';
  return undefined;
}

/** 审批按钮/文本选项的文案（卡片与纯文本兜底共用，保证两处编号一致） */
export const APPROVAL_OPTIONS: ReadonlyArray<{ key: 'allow' | 'deny'; label: string }> = [
  { key: 'allow', label: '✅ 同意（允许一次）' },
  { key: 'deny', label: '❌ 拒绝' },
];

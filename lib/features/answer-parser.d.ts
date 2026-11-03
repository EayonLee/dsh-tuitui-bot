/**
 * 文本回复 → 结构化答案（纯函数，便于单测）。
 *
 * 逐题解析：一次解析一个问题的答案。
 *
 * 推推的交互卡片在帖子里不可用、卡片发送失败或用户直接打字时，都要靠这里兜底，
 * 因此除问答外还提供审批决策的文本解析（按钮不是唯一入口）。
 */
import type { UserQuestion, UserQuestionAnswer } from './question-channel.ts';
/** 把用户对单个问题的文本回复解析为答案 */
export declare function parseAnswer(question: UserQuestion, text: string): UserQuestionAnswer;
/**
 * 审批的文本兜底：解析用户回复的决策。
 *
 * 返回 undefined 表示"这句话不是审批决策"，调用方必须继续走常规消息流程——
 * 审批挂起期间用户完全可能聊别的，不能把任意消息当成拒绝。
 */
export declare function parseApprovalDecision(text: string): 'allow' | 'deny' | undefined;
/** 审批按钮/文本选项的文案（卡片与纯文本兜底共用，保证两处编号一致） */
export declare const APPROVAL_OPTIONS: ReadonlyArray<{
    key: 'allow' | 'deny';
    label: string;
}>;
//# sourceMappingURL=answer-parser.d.ts.map
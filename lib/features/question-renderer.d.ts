/**
 * 问答的文本渲染与卡片按钮构建（纯函数，便于单测）。
 *
 * 逐题渲染：一次只渲染一个问题（多题时由状态机逐题推进）。
 *
 * 推推卡片的 action 是一维按钮条，由客户端自行排版，因此这里不切行。
 */
import type { TuituiInteractiveAction, TuituiOutboundInteractiveMessage } from '@qihoo/tuitui-bot-sdk';
import type { UserQuestion, UserQuestionAnswer } from './question-channel.ts';
import { type CardTheme } from './button-utils.ts';
/**
 * 为「单选、带选项」的问题构建按钮；不适用时返回 undefined。
 *
 * value 编码 `{t:'question',q:<问题id>,i:<选项下标>}`，由分发器解码。
 * `q` 关联「当前正在问的题」：逐题推进时旧题按钮在新题发出后被点击，其 q 不等于
 * 当前题 id，可被识别并忽略。
 */
export declare function buildKeyboard(question: UserQuestion): TuituiInteractiveAction[] | undefined;
/** 把单个问题渲染成文本 */
export declare function formatQuestion(question: UserQuestion, requireMentionHint: boolean, withButtons: boolean): string;
/** 构建问答交互卡片（待作答形态）；actions 为空时调用方应降级为纯文本 */
export declare function buildQuestionCard(question: UserQuestion, requireMentionHint: boolean, actions: TuituiInteractiveAction[], theme?: Partial<CardTheme>): TuituiOutboundInteractiveMessage;
/** 答案的人类可读文案（卡片回写与日志共用） */
export declare function formatAnswer(answer: UserQuestionAnswer): string;
/**
 * 构建已失效卡片（超时 / 被新问题取代）：删掉按钮，明确写「已失效」。
 *
 * 不重写卡片的话，超时那张卡片上的按钮一直可点，用户点下去只会得到
 * 「没有待答问题」，甚至把答案错位到下一题（#42）。
 */
export declare function buildQuestionExpiredCard(question: UserQuestion, reason: 'timeout' | 'superseded' | 'aborted', theme?: Partial<CardTheme>): TuituiOutboundInteractiveMessage;
/**
 * 构建已作答卡片：删掉按钮，把答案写回卡片。
 *
 * 推推没有"点击后自动置灰"的按钮状态，不重写卡片的话同一条卡片里的按钮
 * 会被反复点击，导致答案错位到下一题。
 */
export declare function buildQuestionResolvedCard(question: UserQuestion, answer: UserQuestionAnswer, theme?: Partial<CardTheme>): TuituiOutboundInteractiveMessage;
//# sourceMappingURL=question-renderer.d.ts.map
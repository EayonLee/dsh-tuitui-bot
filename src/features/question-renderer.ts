/**
 * 问答的文本渲染与卡片按钮构建（纯函数，便于单测）。
 *
 * 逐题渲染：一次只渲染一个问题（多题时由状态机逐题推进）。
 *
 * 推推卡片的 action 是一维按钮条，由客户端自行排版，因此这里不切行。
 */
import type { TuituiInteractiveAction, TuituiOutboundInteractiveMessage } from '@qihoo/tuitui-bot-sdk';
import type { UserQuestion, UserQuestionAnswer } from './question-channel.ts';
import { buildAction, buttonLabel, resolveCardTheme, type CardTheme } from './button-utils.ts';

/** 卡片正文里的选项列表（按钮文案会截断，描述只能靠正文承载） */
function optionLines(question: UserQuestion): string[] {
  const opts = question.options ?? [];
  return opts.map((o, i) => `${i + 1}. ${o.label}${o.description ? ` · ${o.description}` : ''}`);
}

/**
 * 为「单选、带选项」的问题构建按钮；不适用时返回 undefined。
 *
 * value 编码 `{t:'question',q:<问题id>,i:<选项下标>}`，由分发器解码。
 * `q` 关联「当前正在问的题」：逐题推进时旧题按钮在新题发出后被点击，其 q 不等于
 * 当前题 id，可被识别并忽略。
 */
export function buildKeyboard(question: UserQuestion): TuituiInteractiveAction[] | undefined {
  const opts = question.options ?? [];
  if (opts.length === 0 || question.multiSelect) return undefined;

  return opts.map((option, idx) => buildAction({
    name: `q-${question.id}-opt-${idx}`,
    text: buttonLabel(option.label),
    value: { t: 'question', q: question.id, i: idx },
  }));
}

/** 把单个问题渲染成文本 */
export function formatQuestion(
  question: UserQuestion,
  requireMentionHint: boolean,
  withButtons: boolean,
): string {
  const lines: string[] = [];
  if (question.header) lines.push(`**${question.header}**`);

  const opts = question.options ?? [];
  const multi = question.multiSelect === true;

  // 问题行：多选标记前置，用户第一眼就知道作答方式
  lines.push(multi ? `${question.question}（可多选）` : question.question);

  lines.push(...optionLines(question));

  // 底部引导：用引用块（>）与正文区分；mention 放在「回复」动作后（点按钮无需 @）
  if (opts.length > 0) {
    lines.push('');
    const mention = requireMentionHint ? '（需 @机器人）' : '';
    if (withButtons) {
      lines.push(`> 👇 点击下方按钮选择，或回复编号${mention}`);
    } else if (multi) {
      lines.push(`> 💡 回复多个编号即可多选（如 1,3）${mention}，或直接输入你的想法`);
    } else {
      lines.push(`> 💡 回复编号选择${mention}，或直接输入你的想法`);
    }
  }

  return lines.join('\n');
}

/** 构建问答交互卡片（待作答形态）；actions 为空时调用方应降级为纯文本 */
export function buildQuestionCard(
  question: UserQuestion,
  requireMentionHint: boolean,
  actions: TuituiInteractiveAction[],
  theme?: Partial<CardTheme>,
): TuituiOutboundInteractiveMessage {
  const resolvedTheme = resolveCardTheme(theme);
  const opts = question.options ?? [];
  const mention = requireMentionHint ? '（需 @机器人）' : '';
  return {
    head: {
      text: question.header ? `❓ ${question.header}` : '❓ 需要你回答',
      bgcolor: resolvedTheme.headBgColor,
      tcolor: resolvedTheme.headTextColor,
    },
    body: {
      title: question.question,
      ...(opts.length > 0 ? { content: optionLines(question).join('\n') } : {}),
    },
    footer: [{ text: `👇 点击下方按钮选择，或回复编号${mention}` }],
    action: actions,
  };
}

/** 答案的人类可读文案（卡片回写与日志共用） */
export function formatAnswer(answer: UserQuestionAnswer): string {
  if (answer.selected.length > 0) {
    return `✅ 已选择：${answer.selected.join('、')}`;
  }
  const custom = (answer.custom ?? '').trim();
  return custom ? `✅ 已回答：${custom}` : '✅ 已作答';
}

/**
 * 构建已作答卡片：删掉按钮，把答案写回卡片。
 *
 * 推推没有"点击后自动置灰"的按钮状态，不重写卡片的话同一条卡片里的按钮
 * 会被反复点击，导致答案错位到下一题。
 */
export function buildQuestionResolvedCard(
  question: UserQuestion,
  answer: UserQuestionAnswer,
  theme?: Partial<CardTheme>,
): TuituiOutboundInteractiveMessage {
  const resolvedTheme = resolveCardTheme(theme);
  const opts = question.options ?? [];
  return {
    head: {
      text: question.header ? `❓ ${question.header}` : '❓ 需要你回答',
      bgcolor: resolvedTheme.headBgColor,
      tcolor: resolvedTheme.headTextColor,
    },
    body: {
      title: question.question,
      content: [...optionLines(question), '', formatAnswer(answer)].join('\n'),
    },
    footer: [{ text: opts.length > 0 ? '该问题已回答' : '该问题已回答（直接输入的内容）' }],
  };
}

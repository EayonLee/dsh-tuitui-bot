/**
 * 「要不要开口」的结构化契约 —— schema 在代码里，不归用户编辑。
 *
 * 为什么要有这个文件：让模型「只输出一行 JSON」纯靠自觉，等于把解析器暴露在
 * 随机输出面前。实测就翻过车——思考型模型把 token 花在推理上，流被截断，
 * 正文一个字没有，于是「本该回一句」被记成 unparsable。
 *
 * 改法是把契约做成工具声明（JSON Schema）随请求下发：模型要么按 schema 调
 * 工具（arguments 就是合法参数），要么走文本兜底。提示词只管性格，格式在
 * 这里定死——用户改提示词改不出解析错误。
 */
/** 模型的回话方式：说句话 / 挂个表情 / 什么都不做 */
export type SmartJudgeAct = 'text' | 'emoji' | 'silent';

/** 判定结果（判定器与中间件共用的一种形状） */
export interface SmartJudgeResult {
  /** true=说话（文本回复），false=不用文本回复 */
  join: boolean;
  /** 模型给的一句话理由（日志用） */
  reason?: string;
  /** 回话方式；缺省按 join 推断 */
  act?: SmartJudgeAct;
  /** act=emoji 时挂的表情 */
  emoji?: string;
}

/** 模型必须调用的工具名 */
export const JOIN_DECISION_TOOL = 'join_decision';

/** 三种处理方式 */
export const JOIN_ACTIONS = ['text', 'emoji', 'silent'] as const;

/** 下发给模型的 JSON Schema（工具参数） */
export const JOIN_DECISION_SCHEMA = {
  type: 'object',
  properties: {
    act: {
      type: 'string',
      enum: [...JOIN_ACTIONS],
      description: 'text=说句话回复；emoji=只给这条消息挂个表情；silent=什么都不做',
    },
    emoji: {
      type: 'string',
      description: 'act=emoji 时挂的表情，单个 emoji，例如 😂',
    },
    why: {
      type: 'string',
      description: '十个字以内的理由，给人看日志用',
    },
  },
  required: ['act'],
  additionalProperties: false,
} as const;

/** 校验一次工具调用参数；不合法返回 undefined，由调用方决定降级 */
export function validateJoinDecision(raw: unknown): SmartJudgeResult | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as { act?: unknown; emoji?: unknown; why?: unknown };
  const act = typeof record.act === 'string' ? record.act.trim().toLowerCase() : '';
  if (!(JOIN_ACTIONS as readonly string[]).includes(act)) return undefined;

  const reason = typeof record.why === 'string' && record.why.trim() !== ''
    ? record.why.trim().slice(0, 60)
    : undefined;
  const base = reason === undefined ? {} : { reason };

  if (act === 'emoji') {
    const emoji = typeof record.emoji === 'string' ? record.emoji.trim().slice(0, 8) : '';
    // 说要挂表情却没给表情：契约不成立，当成没表态
    if (emoji === '') return undefined;
    return { join: false, act: 'emoji', emoji, ...base };
  }
  if (act === 'text') return { join: true, act: 'text', ...base };
  return { join: false, act: 'silent', ...base };
}

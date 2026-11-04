/** 模型必须调用的工具名 */
export const JOIN_DECISION_TOOL = 'join_decision';
/** 三种处理方式 */
export const JOIN_ACTIONS = ['text', 'emoji', 'silent'];
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
};
/** 校验一次工具调用参数；不合法返回 undefined，由调用方决定降级 */
export function validateJoinDecision(raw) {
    if (typeof raw !== 'object' || raw === null)
        return undefined;
    const record = raw;
    const act = typeof record.act === 'string' ? record.act.trim().toLowerCase() : '';
    if (!JOIN_ACTIONS.includes(act))
        return undefined;
    const reason = typeof record.why === 'string' && record.why.trim() !== ''
        ? record.why.trim().slice(0, 60)
        : undefined;
    const base = reason === undefined ? {} : { reason };
    if (act === 'emoji') {
        const emoji = typeof record.emoji === 'string' ? record.emoji.trim().slice(0, 8) : '';
        // 说要挂表情却没给表情：契约不成立，当成没表态
        if (emoji === '')
            return undefined;
        return { join: false, act: 'emoji', emoji, ...base };
    }
    if (act === 'text')
        return { join: true, act: 'text', ...base };
    return { join: false, act: 'silent', ...base };
}
//# sourceMappingURL=join-decision.js.map
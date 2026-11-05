/** 最多展示多少个字段，避免把长列表糊一屏 */
const MAX_FIELDS = 6;
function formatValue(value) {
    if (value === null || value === undefined)
        return '-';
    if (typeof value === 'string')
        return value.length > 80 ? value.slice(0, 77) + '…' : value;
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    if (Array.isArray(value))
        return '(' + String(value.length) + ' 项)';
    if (typeof value === 'object')
        return '{…}';
    return String(value);
}
/** 通用摘要：列出对象的前几个字段，数组只报长度 */
export function summarizeToolResult(value) {
    if (value === null || value === undefined)
        return '（无返回）';
    if (typeof value !== 'object')
        return formatValue(value);
    const entries = Object.entries(value);
    if (entries.length === 0)
        return '（无返回）';
    return entries
        .slice(0, MAX_FIELDS)
        .map(([key, item]) => key + '=' + formatValue(item))
        .join(' · ');
}
/**
 * 宽松的对象输出声明。
 *
 * 不写死 properties：不同 action 返回的字段差别很大，写死反而会在加字段时静默
 * 截断。additionalProperties: true 在 dsh 支持的 schema 子集里。
 */
export function jsonToolOutput() {
    return {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [
            { type: 'text', text: summarizeToolResult(value) },
        ],
    };
}
//# sourceMappingURL=tool-output.js.map
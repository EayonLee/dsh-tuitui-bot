const MAX_PER_TARGET = 10;
const TTL_GROUP = 5 * 60 * 1000; // 群聊 5 分钟
const TTL_C2C = 30 * 60 * 1000; // 私聊 30 分钟
const TTL_POST = 30 * 60 * 1000; // 团队帖子 30 分钟
const MAX_TARGETS = 200;
const EVENT_PREFIX = 'INTERACTION_ACTION:';
const cache = new Map();
function cacheKey(scope, targetId) {
    return `${scope}:${targetId}`;
}
function ttlOf(scope) {
    if (scope === 'group')
        return TTL_GROUP;
    if (scope === 'post')
        return TTL_POST;
    return TTL_C2C;
}
function push(scope, targetId, target) {
    if (!scope || !targetId || !target.id)
        return;
    const key = cacheKey(scope, targetId);
    const existing = cache.get(key);
    if (existing) {
        cache.delete(key);
        existing.push({ target, timestamp: Date.now() });
        if (existing.length > MAX_PER_TARGET)
            existing.shift();
        cache.set(key, existing);
        return;
    }
    cache.set(key, [{ target, timestamp: Date.now() }]);
    if (cache.size > MAX_TARGETS) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined)
            cache.delete(oldest);
    }
}
/** 记录普通消息 msgId */
export function cacheMsgId(scope, targetId, msgId) {
    if (!msgId)
        return;
    push(scope, targetId, { kind: 'msg', id: msgId });
}
/** 记录交互回调 eventId（内部拼前缀，便于与 msgId 区分展示） */
export function cacheEventId(scope, targetId, eventId) {
    if (!eventId)
        return;
    push(scope, targetId, { kind: 'event', id: `${EVENT_PREFIX}${eventId}` });
}
/** 获取所有未过期的引用目标（按时间倒序，最新在前） */
export function getCachedReplyIds(scope, targetId) {
    const list = cache.get(cacheKey(scope, targetId));
    if (!list || list.length === 0)
        return [];
    const now = Date.now();
    const ttl = ttlOf(scope);
    const result = [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
        const entry = list[i];
        if (entry !== undefined && now - entry.timestamp < ttl) {
            result.push(entry.target);
        }
    }
    return result;
}
/**
 * 取最近一条未过期的**普通消息** id（引用回复用）。
 *
 * 交互回调的 eventId 不是可引用的消息，故跳过；没有候选时返回 undefined，
 * 调用方据此退化为"不引用、直接发送"。
 */
export function getMsgId(scope, targetId) {
    for (const candidate of getCachedReplyIds(scope, targetId)) {
        if (candidate.kind === 'msg')
            return candidate.id;
    }
    return undefined;
}
//# sourceMappingURL=msgid-cache.js.map
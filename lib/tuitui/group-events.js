const NOTICE = {
    group_create: '群聊被创建',
    group_invite: '我被拉进了这个群',
    group_kick: '我被移出了这个群',
};
/** 事件体里各处可能叫 group_id / groupId / chat_id，取到一个算一个 */
function pickGroupId(data) {
    if (typeof data !== 'object' || data === null)
        return undefined;
    const record = data;
    for (const key of ['group_id', 'groupId', 'chat_id', 'chatId', 'id']) {
        const value = record[key];
        if (typeof value === 'string' && value !== '')
            return value;
    }
    const nested = record.data;
    if (nested !== undefined && nested !== data)
        return pickGroupId(nested);
    return undefined;
}
function pickGroupName(data) {
    if (typeof data !== 'object' || data === null)
        return undefined;
    const record = data;
    for (const key of ['group_name', 'groupName', 'name']) {
        const value = record[key];
        if (typeof value === 'string' && value !== '')
            return value;
    }
    return undefined;
}
/**
 * 识别群事件并生成系统通知；不是群事件返回 undefined。
 *
 * @param event 推推事件名（body.event）
 * @param data  事件体（body.data）
 */
export function describeGroupEvent(event, data) {
    if (event !== 'group_create' && event !== 'group_invite' && event !== 'group_kick')
        return undefined;
    const groupId = pickGroupId(data);
    const name = pickGroupName(data);
    const head = NOTICE[event];
    const text = name === undefined ? `[系统] ${head}` : `[系统] ${head}：${name}`;
    return groupId === undefined ? { text } : { groupId, text };
}
/** 把群事件写进判定历史（写不进去只记 warn，不影响主流程） */
export function recordGroupEvent(store, key, notice, logger) {
    try {
        store.append(key, {
            senderId: 'system',
            senderName: '系统',
            content: notice.text,
            timestamp: Date.now(),
            messageId: `sys-${notice.text}-${Date.now()}`,
        }, 50);
    }
    catch (error) {
        logger.warn(`[tuitui/group-event] 记录失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}
//# sourceMappingURL=group-events.js.map
/**
 * 机器人最近一次说话的记录（会话重置时清掉）。
 *
 * 智能模式已经不靠它判断要不要插嘴——那是模型的事。这里只剩两件事：
 * 出站时打个时间戳、/new 重置时清掉，给状态查询/排障用。
 */
/** key = `${scope}:${peerId}`，与 sessionKey 的后两段一致 */
const store = new Map();
function keyOf(scope, peerId) {
    return `${scope}:${peerId}`;
}
/** 记录一次机器人回复（由出站链路在产出文本时调用） */
export function markBotReply(scope, peerId, senderId, now = Date.now()) {
    if (peerId === '')
        return;
    store.set(keyOf(scope, peerId), { at: now, senderId });
}
/** 清掉某个会话的追问标记（/new 重置后调用，避免把旧对话当成延续） */
export function clearFollowUp(scope, peerId) {
    store.delete(keyOf(scope, peerId));
}
/** 清空（测试用） */
export function clearFollowUps() {
    store.clear();
}
//# sourceMappingURL=followup-store.js.map
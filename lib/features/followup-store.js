/**
 * 追问窗口记录 — 支撑「智能触发」模式
 *
 * 单纯的「必须 @」会漏掉自然对话：用户 @ 过一次之后接着追问「那再帮我改下」
 * 往往不会再 @。这里只记「机器人最近一次在该会话里说过话」的时间与对象，
 * 由 mention-gate 判断「这条消息是不是刚才那轮对话的延续」。
 *
 * 只保留内存态：进程重启后没记录 = 必输 @，宁可少答也不要乱插话。
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
/**
 * 这条消息是不是「刚聊过」的延续。
 *
 * 判定条件（都满足才算）：
 *   1. 该会话在 windowMs 内有过机器人回复；
 *   2. 发送者是当时对话的同一个人（换人说话不算延续，避免抢答别人的问题）。
 */
export function isLikelyFollowUp(scope, peerId, senderId, windowMs, now = Date.now()) {
    const entry = store.get(keyOf(scope, peerId));
    if (entry === undefined)
        return false;
    if (now - entry.at > windowMs)
        return false;
    if (senderId === '')
        return false;
    return entry.senderId === '' || entry.senderId === senderId;
}
/** 清空（测试用） */
export function clearFollowUps() {
    store.clear();
}
//# sourceMappingURL=followup-store.js.map
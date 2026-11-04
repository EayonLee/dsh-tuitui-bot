const pending = new Map();
function keyOf(target, msgId) {
    return `${target.scope}:${target.targetId}:${msgId}`;
}
/** 收到消息：登记一个待兑现的回执（同一个 msgid 重复登记以最后一次为准） */
export function registerReceipt(entry) {
    pending.set(keyOf(entry.target, entry.msgId), entry);
}
/** 有没有这笔待兑现的回执（测试 / 诊断用） */
export function hasReceipt(target, msgId) {
    return pending.has(keyOf(target, msgId));
}
/** 测试用：清空登记表 */
export function resetReceipts() {
    pending.clear();
}
/**
 * 兑现回执。
 *
 * @param outcome done 回复已发出 / fail 处理出错 / none 这一轮不说话
 * @param messageId 指定 msgid（sender 知道自己在回哪条）；省略则按 target 找最近的一条
 */
export async function settleReceipt(target, outcome, messageId) {
    const key = messageId === undefined ? undefined : keyOf(target, messageId);
    let entry;
    if (key !== undefined) {
        entry = pending.get(key);
        if (entry !== undefined)
            pending.delete(key);
    }
    else {
        // 按 target 找：一轮里通常只有一条待兑现的回执
        for (const [k, value] of pending) {
            if (value.target.scope === target.scope && value.target.targetId === target.targetId) {
                entry = value;
                pending.delete(k);
                break;
            }
        }
    }
    if (entry === undefined)
        return;
    const emoji = outcome === 'done' ? entry.done : outcome === 'fail' ? entry.fail : '';
    try {
        // 先把 👀 撤掉，再挂新表情；两步都不做的话，回执会停在「在算」
        await entry.bot.emojiReaction(entry.target, entry.msgId, '👀', true).catch(() => { });
        if (emoji !== '')
            await entry.bot.emojiReaction(entry.target, entry.msgId, emoji);
    }
    catch {
        // 回执失败不影响任何主流程
    }
}
//# sourceMappingURL=receipt-registry.js.map
/**
 * 内存环形缓冲实现（单进程部署足够）。
 *
 * 按 messageId 去重：推推在断线重连时会重投未确认事件，重复入账会让模型
 * 看到两条一模一样的消息。
 */
export class MemoryHistoryStore {
    buffers = new Map();
    append(groupKey, entry, limit) {
        let buf = this.buffers.get(groupKey);
        if (!buf) {
            buf = [];
            this.buffers.set(groupKey, buf);
        }
        if (buf.some((e) => e.messageId === entry.messageId))
            return;
        buf.push(entry);
        if (buf.length > limit) {
            buf.splice(0, buf.length - limit);
        }
    }
    list(groupKey, limit) {
        const buf = this.buffers.get(groupKey);
        if (!buf)
            return [];
        return buf.slice(-limit);
    }
    clear(groupKey) {
        this.buffers.delete(groupKey);
    }
    /** 诊断：当前有历史的会话数 */
    size() {
        return this.buffers.size;
    }
}
let _store = null;
let _judgeStore = null;
/** 获取共享历史存储（单例：中间件与出站清理必须看到同一份数据） */
export function getHistoryStore() {
    if (!_store)
        _store = new MemoryHistoryStore();
    return _store;
}
/**
 * 判定专用的历史存储（只加不删）。
 *
 * 普通历史在回复完就被 `clearGroupHistory` 清掉——那是为了不让下一轮 prompt
 * 重复灌一遍旧群聊。但智能判定要看的就是「刚才你们在聊什么」，跟着一起被清空
 * 的话，每轮判定只能看到上一条消息，判断自然发傻。所以判定单独留一份环形缓冲。
 */
export function getJudgeHistoryStore() {
    if (!_judgeStore)
        _judgeStore = new MemoryHistoryStore();
    return _judgeStore;
}
/** 测试用：清掉单例，避免用例之间互相污染 */
export function resetHistoryStores() {
    _store = null;
    _judgeStore = null;
}
/**
 * 用 appId 前缀隔离历史（同一进程挂多个机器人账号时互不串台）。
 *
 * peerId 由调用方决定：群聊是 group_id，团队帖子是 `teamId/channelId`。
 */
export function historyGroupKey(appId, peerId) {
    return `${appId}:${peerId}`;
}
/** 清空某个会话的历史（回复后调用，避免下次 @ 时重复组包） */
export function clearGroupHistory(appId, peerId) {
    _store?.clear(historyGroupKey(appId, peerId));
}
//# sourceMappingURL=history-store.js.map
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
/** 获取共享历史存储（单例：中间件与出站清理必须看到同一份数据） */
export function getHistoryStore() {
    if (!_store)
        _store = new MemoryHistoryStore();
    return _store;
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
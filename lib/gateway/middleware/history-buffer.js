/** 默认内存实现：每桶一个环形缓冲，适合单进程部署 */
export class MemoryHistoryStore {
    buffers = new Map();
    append(groupKey, entry, limit) {
        let buf = this.buffers.get(groupKey);
        if (!buf) {
            buf = [];
            this.buffers.set(groupKey, buf);
        }
        // 按 msgid 去重：事件重投时不能把同一句话记两遍，否则 prompt 里会出现重复上下文
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
    /** 诊断：当前有多少个群/频道持有缓冲 */
    size() {
        return this.buffers.size;
    }
}
/**
 * 默认分桶键（不含 appId 前缀；多账号场景由调用方用 historyGroupKey 包一层）。
 */
export function defaultHistoryKey(ctx) {
    const msg = ctx.message;
    if (msg.kind === 'group')
        return msg.groupId;
    if (msg.kind === 'post' && msg.post)
        return `${msg.post.teamId}/${msg.post.channelId}`;
    return undefined;
}
export function historyBuffer(options = {}) {
    const limit = options.limit ?? 50;
    const store = options.store ?? new MemoryHistoryStore();
    const recordOnSkip = options.recordOnSkip ?? true;
    const getKey = options.groupKey ?? defaultHistoryKey;
    const log = options.logger;
    return async (ctx, next) => {
        const key = getKey(ctx);
        // 单聊没有「群上下文」可言，直接放行
        if (!key) {
            await next();
            return;
        }
        // 1. 先取出「上一条为止」的缓冲交给下游 —— 当前这条还不能算进历史，
        //    否则模型会把正在回答的这句话再读一遍。
        try {
            ctx.state.history = await store.list(key, limit);
        }
        catch (err) {
            log?.error(`[history-buffer] 读取历史失败: ${err instanceof Error ? err.message : String(err)}`);
            ctx.state.history = [];
        }
        // 2. 再把当前消息记进去，供下一条消息使用
        const entry = {
            senderId: ctx.message.senderId,
            senderName: ctx.message.senderName,
            content: ctx.message.content,
            timestamp: Date.parse(ctx.message.timestamp) || Date.now(),
            messageId: ctx.message.messageId,
        };
        try {
            await store.append(key, entry, limit);
        }
        catch (err) {
            // 记账失败不能阻断消息处理：宁可这轮少点上下文，也别让用户没回应
            log?.error(`[history-buffer] 写入历史失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (ctx.skipped !== undefined && !recordOnSkip) {
            return;
        }
        await next();
    };
}
//# sourceMappingURL=history-buffer.js.map
export function messageFilter(options = {}) {
    const skipSelfEcho = options.skipSelfEcho ?? true;
    const dedupOptions = options.dedup === false
        ? null
        : {
            windowMs: options.dedup?.windowMs ?? 5000,
            maxSize: options.dedup?.maxSize ?? 1000,
            now: options.dedup?.now ?? (() => Date.now()),
        };
    const seen = dedupOptions ? new Map() : null;
    const log = options.logger;
    /** 超出容量时从最老的开始淘汰（Map 保持插入序，故顺序遍历即时间序） */
    function evict(now) {
        if (!seen || !dedupOptions)
            return;
        if (seen.size <= dedupOptions.maxSize)
            return;
        for (const [key, ts] of seen) {
            // 已过窗口或仍超容量 → 淘汰；否则后面的只会更新，可以提前收工
            if (now - ts > dedupOptions.windowMs || seen.size > dedupOptions.maxSize) {
                seen.delete(key);
            }
            else {
                break;
            }
        }
    }
    return async (ctx, next) => {
        // 1. 自回声
        if (skipSelfEcho && ctx.message.fromBot === true) {
            log?.debug('[message-filter] 丢弃机器人自回声消息');
            ctx.skip('self-echo');
            return;
        }
        // 2. 去重
        if (seen && dedupOptions) {
            const id = ctx.message.messageId;
            if (!id) {
                await next();
                return;
            }
            const now = dedupOptions.now();
            const seenAt = seen.get(id);
            // 只有仍在窗口内的重复才算重复：回过期后同一条 msgid 再次出现
            // （例如客户端重发了一条一模一样的消息）应当照常处理。
            if (seenAt !== undefined && now - seenAt <= dedupOptions.windowMs) {
                log?.debug(`[message-filter] 丢弃重复消息 msgid=${id}`);
                ctx.skip('dedup');
                return;
            }
            seen.set(id, now);
            evict(now);
        }
        await next();
    };
}
//# sourceMappingURL=message-filter.js.map
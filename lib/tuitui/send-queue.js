export class SendQueue {
    options;
    tails = new Map();
    pending = new Map();
    constructor(options) {
        this.options = options;
    }
    /** 当前某会话排队中（含正在执行）的条数 */
    size(key) {
        return this.pending.get(key) ?? 0;
    }
    /**
     * 把任务排进 key 的队尾。
     *
     * 返回的 Promise 就是任务本身的结果：失败会原样抛给调用方，
     * 但不会影响队列里后面的任务。
     */
    run(key, task) {
        const queued = this.pending.get(key) ?? 0;
        if (queued > this.options.maxPendingPerKey) {
            this.options.onDrop?.(key);
            return Promise.reject(new SendQueueOverflowError(key, this.options.maxPendingPerKey));
        }
        this.pending.set(key, queued + 1);
        const previous = this.tails.get(key) ?? Promise.resolve();
        // 前一条失败不能把后一条带下水，所以这里固定用 resolved
        const current = previous.then(task, task);
        this.tails.set(key, current.catch(() => undefined));
        const cleanup = () => {
            const remaining = (this.pending.get(key) ?? 1) - 1;
            if (remaining <= 0) {
                this.pending.delete(key);
                this.tails.delete(key);
            }
            else {
                this.pending.set(key, remaining);
            }
        };
        void current.then(cleanup, cleanup);
        return current;
    }
}
export class SendQueueOverflowError extends Error {
    key;
    limit;
    constructor(key, limit) {
        super(`发送队列已满（${key} 排队超过 ${String(limit)} 条），本条丢弃`);
        this.name = 'SendQueueOverflowError';
        this.key = key;
        this.limit = limit;
    }
}
//# sourceMappingURL=send-queue.js.map
export class IdleEvictor {
    timer = null;
    sessions;
    timeoutMs;
    onEvict;
    constructor(sessions, timeoutMs, onEvict) {
        this.sessions = sessions;
        this.timeoutMs = timeoutMs;
        this.onEvict = onEvict;
        if (timeoutMs > 0) {
            this.timer = setInterval(() => this.check(), 60_000);
        }
    }
    /** 执行一轮回收检查 */
    check() {
        const now = Date.now();
        for (const [key, record] of this.sessions) {
            if (now - record.lastActivity <= this.timeoutMs)
                continue;
            // 正在跑的一轮不回收：长任务期间不会有新消息，按时间判定会误杀
            if (record.agent.status !== 'idle')
                continue;
            this.onEvict(key, record);
        }
    }
    /** 停止回收定时器 */
    dispose() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}
//# sourceMappingURL=idle-evictor.js.map
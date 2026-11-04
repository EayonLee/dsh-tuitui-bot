const DEFAULT_STALE_MS = 30 * 60_000;
const DEFAULT_HEARTBEAT_MS = 5 * 60_000;
const DEFAULT_INTERVAL_MS = 60_000;
function ago(ms, now) {
    if (ms === null)
        return 'never';
    const delta = Math.max(0, now - ms);
    if (delta < 60_000)
        return `${Math.round(delta / 1000)}s`;
    if (delta < 3_600_000)
        return `${Math.round(delta / 60_000)}m`;
    return `${Math.round(delta / 3_600_000)}h`;
}
export class ConnectionWatch {
    logger;
    staleAfterMs;
    heartbeatEveryMs;
    intervalMs;
    rebuild;
    clock;
    connected = false;
    connectedAt = null;
    lastEventAt = null;
    lastDisconnectedAt = null;
    lastError = null;
    lastHeartbeatAt = 0;
    timer = null;
    /** 重建次数，便于排查「一晚上重建了 8 次」这种抖动 */
    rebuilds = 0;
    constructor(options) {
        this.logger = options.logger;
        this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_MS;
        this.heartbeatEveryMs = options.heartbeatEveryMs ?? DEFAULT_HEARTBEAT_MS;
        this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
        this.rebuild = options.rebuild;
        this.clock = options.now ?? (() => Date.now());
    }
    markConnected() {
        this.connected = true;
        this.connectedAt = this.clock();
        // 新连接重新计数：上一次连接收到的最后一个事件不算这一次的
        this.lastEventAt = null;
        this.lastError = null;
    }
    markDisconnected(reason) {
        this.connected = false;
        this.lastDisconnectedAt = this.clock();
        this.lastError = reason instanceof Error ? reason.message : String(reason ?? '连接已断开');
    }
    markError(error) {
        this.lastError = error instanceof Error ? error.message : String(error);
    }
    markEvent() {
        this.lastEventAt = this.clock();
    }
    start() {
        if (this.timer !== null)
            return;
        this.timer = setInterval(() => {
            try {
                this.tick();
            }
            catch (err) {
                this.logger.warn(`[tuitui/watch] 巡检异常: ${err instanceof Error ? err.message : String(err)}`);
            }
        }, this.intervalMs);
        // 插件卸载时不该被这个定时器拖着不退
        this.timer.unref?.();
    }
    stop() {
        if (this.timer !== null)
            clearInterval(this.timer);
        this.timer = null;
    }
    /** 单次巡检（start 每 intervalMs 调一次，单测直接调） */
    tick() {
        const now = this.clock();
        // 僵死判定：连上了，但从连上到现在一条事件都没有
        if (this.connected && this.lastEventAt === null && this.connectedAt !== null) {
            if (now - this.connectedAt >= this.staleAfterMs) {
                this.rebuilds += 1;
                this.logger.warn(`[tuitui/watch] 连接 ${ago(this.connectedAt, now)} 没收到任何事件，判定僵死，重建订阅（第 ${this.rebuilds} 次）`);
                // 重建前先复位，避免 rebuild 抛错后每次巡检都重复触发
                this.connectedAt = now;
                this.connected = false;
                this.rebuild?.();
                return 'stale-rebuild';
            }
        }
        if (now - this.lastHeartbeatAt >= this.heartbeatEveryMs) {
            this.lastHeartbeatAt = now;
            this.logger.info(`[tuitui/watch] connected=${this.connected} connectedAt=${ago(this.connectedAt, now)} ` +
                `lastEvent=${ago(this.lastEventAt, now)} lastError=${this.lastError ?? '-'} rebuilds=${this.rebuilds}`);
            return 'heartbeat';
        }
        return 'none';
    }
    /** 只读快照（写进状态接口/日志用） */
    snapshot() {
        return {
            connected: this.connected,
            connectedAt: this.connectedAt,
            lastEventAt: this.lastEventAt,
            lastDisconnectedAt: this.lastDisconnectedAt,
            lastError: this.lastError,
            rebuilds: this.rebuilds,
        };
    }
}
//# sourceMappingURL=connection-watch.js.map
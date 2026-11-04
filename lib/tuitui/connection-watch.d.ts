/**
 * 长连接看门狗
 *
 * SDK 自己会退避重连、也有心跳超时——但心跳过得去、事件却不来的「僵死连接」
 * 它认不出来：连上了、心跳还在、消息一条不进。这种状态下机器人看着健康，
 * 实际上谁说话它都听不见，而且永远不会自己恢复。
 *
 * 这里补两件事：
 * 1. 连上之后一段时间（默认 30 分钟）一条事件都没收到 → 判定僵死，重建订阅；
 * 2. 每 5 分钟把状态打一行日志（连了多久、最近事件多久以前、最后一次错误），
 *    出问题时日志里能看到「它到底还活着吗」，而不是只能猜。
 */
import type { Logger } from '../types.ts';
export interface ConnectionWatchOptions {
    logger: Logger;
    /** 连上后多久没有任何事件算僵死，默认 30 分钟 */
    staleAfterMs?: number;
    /** 状态日志间隔，默认 5 分钟 */
    heartbeatEveryMs?: number;
    /** 巡检间隔，默认 60 秒 */
    intervalMs?: number;
    /** 判定僵死后的重建动作（取消订阅 + 重新订阅） */
    rebuild?: () => void;
    /** 注入时钟，单测用 */
    now?: () => number;
}
export type WatchAction = 'stale-rebuild' | 'heartbeat' | 'none';
export declare class ConnectionWatch {
    private readonly logger;
    private readonly staleAfterMs;
    private readonly heartbeatEveryMs;
    private readonly intervalMs;
    private readonly rebuild?;
    private readonly clock;
    private connected;
    private connectedAt;
    private lastEventAt;
    private lastDisconnectedAt;
    private lastError;
    private lastHeartbeatAt;
    private timer;
    /** 重建次数，便于排查「一晚上重建了 8 次」这种抖动 */
    private rebuilds;
    constructor(options: ConnectionWatchOptions);
    markConnected(): void;
    markDisconnected(reason: unknown): void;
    markError(error: unknown): void;
    markEvent(): void;
    start(): void;
    stop(): void;
    /** 单次巡检（start 每 intervalMs 调一次，单测直接调） */
    tick(): WatchAction;
    /** 只读快照（写进状态接口/日志用） */
    snapshot(): {
        connected: boolean;
        connectedAt: number | null;
        lastEventAt: number | null;
        lastDisconnectedAt: number | null;
        lastError: string | null;
        rebuilds: number;
    };
}
//# sourceMappingURL=connection-watch.d.ts.map
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

const DEFAULT_STALE_MS = 30 * 60_000;
const DEFAULT_HEARTBEAT_MS = 5 * 60_000;
const DEFAULT_INTERVAL_MS = 60_000;

function ago(ms: number | null, now: number): string {
  if (ms === null) return 'never';
  const delta = Math.max(0, now - ms);
  if (delta < 60_000) return `${Math.round(delta / 1000)}s`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m`;
  return `${Math.round(delta / 3_600_000)}h`;
}

export class ConnectionWatch {
  private readonly logger: Logger;
  private readonly staleAfterMs: number;
  private readonly heartbeatEveryMs: number;
  private readonly intervalMs: number;
  private readonly rebuild?: () => void;
  private readonly clock: () => number;

  private connected = false;
  private connectedAt: number | null = null;
  private lastEventAt: number | null = null;
  private lastDisconnectedAt: number | null = null;
  private lastError: string | null = null;
  private lastHeartbeatAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 重建次数，便于排查「一晚上重建了 8 次」这种抖动 */
  private rebuilds = 0;

  constructor(options: ConnectionWatchOptions) {
    this.logger = options.logger;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_MS;
    this.heartbeatEveryMs = options.heartbeatEveryMs ?? DEFAULT_HEARTBEAT_MS;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.rebuild = options.rebuild;
    this.clock = options.now ?? (() => Date.now());
  }

  markConnected(): void {
    this.connected = true;
    this.connectedAt = this.clock();
    // 新连接重新计数：上一次连接收到的最后一个事件不算这一次的
    this.lastEventAt = null;
    this.lastError = null;
  }

  markDisconnected(reason: unknown): void {
    this.connected = false;
    this.lastDisconnectedAt = this.clock();
    this.lastError = reason instanceof Error ? reason.message : String(reason ?? '连接已断开');
  }

  markError(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
  }

  markEvent(): void {
    this.lastEventAt = this.clock();
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        this.logger.warn(`[tuitui/watch] 巡检异常: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, this.intervalMs);
    // 插件卸载时不该被这个定时器拖着不退
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** 单次巡检（start 每 intervalMs 调一次，单测直接调） */
  tick(): WatchAction {
    const now = this.clock();

    // 僵死判定：连上了，但从连上到现在一条事件都没有
    if (this.connected && this.lastEventAt === null && this.connectedAt !== null) {
      if (now - this.connectedAt >= this.staleAfterMs) {
        this.rebuilds += 1;
        this.logger.warn(
          `[tuitui/watch] 连接 ${ago(this.connectedAt, now)} 没收到任何事件，判定僵死，重建订阅（第 ${this.rebuilds} 次）`,
        );
        // 重建前先复位，避免 rebuild 抛错后每次巡检都重复触发
        this.connectedAt = now;
        this.connected = false;
        this.rebuild?.();
        return 'stale-rebuild';
      }
    }

    if (now - this.lastHeartbeatAt >= this.heartbeatEveryMs) {
      this.lastHeartbeatAt = now;
      this.logger.info(
        `[tuitui/watch] connected=${this.connected} connectedAt=${ago(this.connectedAt, now)} ` +
          `lastEvent=${ago(this.lastEventAt, now)} lastError=${this.lastError ?? '-'} rebuilds=${this.rebuilds}`,
      );
      return 'heartbeat';
    }

    return 'none';
  }

  /** 只读快照（写进状态接口/日志用） */
  snapshot(): {
    connected: boolean;
    connectedAt: number | null;
    lastEventAt: number | null;
    lastDisconnectedAt: number | null;
    lastError: string | null;
    rebuilds: number;
  } {
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

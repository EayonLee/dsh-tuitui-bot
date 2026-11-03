/**
 * IdleEvictor — 闲置会话回收器
 *
 * 定期检查会话最后活跃时间，超时则自动回收释放资源。
 *
 * ⚠️ 「闲置」只按「多久没有新消息进来」算不够：一轮长任务（重构仓库、跑
 * 一整套测试）期间没有任何新消息，lastActivity 会一路陈旧，超过阈值就会把
 * 正在干活的 agent 取消掉——用户看到的是「跑到一半突然没了」。因此回收前
 * 必须确认 agent 已回到 idle；跑着的一律跳过，下一轮再评估。
 */
import type { SessionRecord } from './types.ts';

export class IdleEvictor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly sessions: Map<string, SessionRecord>;
  private readonly timeoutMs: number;
  private readonly onEvict: (key: string, record: SessionRecord) => void;

  constructor(
    sessions: Map<string, SessionRecord>,
    timeoutMs: number,
    onEvict: (key: string, record: SessionRecord) => void,
  ) {
    this.sessions = sessions;
    this.timeoutMs = timeoutMs;
    this.onEvict = onEvict;
    if (timeoutMs > 0) {
      this.timer = setInterval(() => this.check(), 60_000);
    }
  }

  /** 执行一轮回收检查 */
  check(): void {
    const now = Date.now();
    for (const [key, record] of this.sessions) {
      if (now - record.lastActivity <= this.timeoutMs) continue;
      // 正在跑的一轮不回收：长任务期间不会有新消息，按时间判定会误杀
      if (record.agent.status !== 'idle') continue;
      this.onEvict(key, record);
    }
  }

  /** 停止回收定时器 */
  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

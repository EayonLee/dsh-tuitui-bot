/**
 * 出站节流守卫 — 同一 target 限速 + 同内容去重
 *
 * 推推的 referenceMessageId 只影响展示，不消耗额度，所以这里不做按条的回复
 * 配额，只处理"不能刷屏"：流式被关闭或降级后，切分出的多个 chunk、工具结果、
 * 错误提示、交付物清单会在几百毫秒内连续发出七八条消息，客户端会把它们挤成
 * 一片并触发服务端频控。守卫做三件事：
 *   1. 同一 target 的最小发送间隔（默认 300ms），保证消息按序、可读地下发；
 *   2. 相同内容的短时间去重（默认 2s），挡掉"重试 / 事件重放导致重复发送同一段"；
 *   3. 超限**排队而非丢弃**：等一等只是延迟，把内容吞掉才是越权。
 */

export interface ReplyLimiterConfig {
  /** 同一 target 两次发送的最小间隔（ms，默认 300） */
  minIntervalMs?: number;
  /** 相同内容的去重窗口（ms，默认 2000） */
  dedupeWindowMs?: number;
  /** 最多跟踪多少 target（超出按插入顺序驱逐，默认 1000，防长期运行泄漏） */
  maxTrackedTargets?: number;
}

/** 一次发送判定结果 */
export interface ReplyLimitResult {
  /** 是否放行（false = 命中同内容去重窗口，本次不发） */
  allowed: boolean;
  /** 被去重或被节流时的原因（allowed=false 时必为 deduped） */
  reason?: 'deduped' | 'throttled';
  /** 距离可以发送还需等待的毫秒数（0 = 立即） */
  waitMs: number;
}

interface TargetState {
  /** 该 target 的串行链：保证发送顺序与节流判定不交叉 */
  chain: Promise<void>;
  lastSentAt: number;
  lastContent: string;
  lastContentAt: number;
}

const DEFAULT_MIN_INTERVAL_MS = 300;
const DEFAULT_DEDUPE_WINDOW_MS = 2000;
const DEFAULT_MAX_TRACKED_TARGETS = 1000;

/** 可清除的等待（与 setTimeout 等价，单独包一层只为可读性） */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ReplyLimiter {
  private readonly minIntervalMs: number;
  private readonly dedupeWindowMs: number;
  private readonly maxTracked: number;
  private readonly targets = new Map<string, TargetState>();

  public constructor(config?: ReplyLimiterConfig) {
    this.minIntervalMs = Math.max(0, config?.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
    this.dedupeWindowMs = Math.max(0, config?.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS);
    this.maxTracked = Math.max(1, config?.maxTrackedTargets ?? DEFAULT_MAX_TRACKED_TARGETS);
  }

  /**
   * 纯查询：这次发送会被去重吗？需要等多久？
   *
   * 不改变任何状态——排队中的任务在真正执行前会重新查一次（见 run），
   * 因为排队期间同一 target 可能已经发出过相同内容。
   */
  public check(targetKey: string, content: string): ReplyLimitResult {
    const state = this.targets.get(targetKey);
    if (state === undefined) return { allowed: true, waitMs: 0 };

    const now = Date.now();
    if (state.lastContent === content && now - state.lastContentAt < this.dedupeWindowMs) {
      return { allowed: false, reason: 'deduped', waitMs: 0 };
    }

    const elapsed = now - state.lastSentAt;
    if (elapsed < this.minIntervalMs) {
      return { allowed: true, reason: 'throttled', waitMs: this.minIntervalMs - elapsed };
    }
    return { allowed: true, waitMs: 0 };
  }

  /** 记录一次真正落地的发送（外部直接发消息时也可手动记账） */
  public record(targetKey: string, content?: string): void {
    const now = Date.now();
    const state = this.targetState(targetKey);
    state.lastSentAt = now;
    if (content !== undefined) {
      state.lastContent = content;
      state.lastContentAt = now;
    }
  }

  /**
   * 排队发送：同 target 串行、按最小间隔节流、同内容短时间去重。
   *
   * 去重命中时返回 undefined（调用方据此知道"这次没发"，但不算失败）；
   * task 自身抛出的异常原样向上传递，交由调用方记录日志——发送失败不该让
   * 后续排队的消息全部沉默。
   */
  public run<T>(targetKey: string, content: string, task: () => Promise<T>): Promise<T | undefined> {
    const state = this.targetState(targetKey);
    const result = state.chain.then(async (): Promise<T | undefined> => {
      const decision = this.check(targetKey, content);
      if (!decision.allowed) return undefined;
      if (decision.waitMs > 0) await delay(decision.waitMs);
      const value = await task();
      this.record(targetKey, content);
      return value;
    });
    // 链上只保留"已完成"信号：任何一次失败都不能毒化后续排队
    state.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** 取（或建）target 状态，超出上限时驱逐最早登记的那个 */
  private targetState(targetKey: string): TargetState {
    const existing = this.targets.get(targetKey);
    if (existing !== undefined) return existing;

    if (this.targets.size >= this.maxTracked) {
      const oldest = this.targets.keys().next().value;
      if (oldest !== undefined) this.targets.delete(oldest);
    }
    const created: TargetState = {
      chain: Promise.resolve(),
      lastSentAt: 0,
      lastContent: '',
      lastContentAt: 0,
    };
    this.targets.set(targetKey, created);
    return created;
  }
}

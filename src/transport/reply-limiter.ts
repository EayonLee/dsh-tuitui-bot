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
  /**
   * 单次发送的超时（ms，默认 15000；0 = 不限）。
   *
   * SDK 的 HTTP 层不接受 signal，一次「连上了但永不返回」的请求会把该 target
   * 的串行链永久挂住，之后所有发送都排在这条链后面，表现为该会话彻底静默
   * （#37）。超时只解除阻塞、不自动重试：重试可能让已经送达的消息重复。
   */
  taskTimeoutMs?: number;
  /** 超时告警出口（宿主 logger） */
  logger?: { warn(message: string): void };
}

/** 发送超时：调用方可以据此区分「网络失败」与「永久挂死」 */
export class ReplyTimeoutError extends Error {
  public readonly targetKey: string;
  public readonly timeoutMs: number;

  public constructor(targetKey: string, timeoutMs: number) {
    super(`发送超时（${timeoutMs}ms 未返回）：${targetKey}`);
    this.name = 'ReplyTimeoutError';
    this.targetKey = targetKey;
    this.timeoutMs = timeoutMs;
  }
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
const DEFAULT_TASK_TIMEOUT_MS = 15 * 1000;

/** 可清除的等待（与 setTimeout 等价，单独包一层只为可读性） */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ReplyLimiter {
  private readonly minIntervalMs: number;
  private readonly dedupeWindowMs: number;
  private readonly maxTracked: number;
  private readonly taskTimeoutMs: number;
  private readonly logger: { warn(message: string): void } | undefined;
  private readonly targets = new Map<string, TargetState>();

  public constructor(config?: ReplyLimiterConfig) {
    this.minIntervalMs = Math.max(0, config?.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
    this.dedupeWindowMs = Math.max(0, config?.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS);
    this.maxTracked = Math.max(1, config?.maxTrackedTargets ?? DEFAULT_MAX_TRACKED_TARGETS);
    this.taskTimeoutMs = Math.max(0, config?.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS);
    this.logger = config?.logger;
  }

  /**
   * 给单次发送加超时。超时后抛 ReplyTimeoutError，串行链照常往后走
   * （链本身在 run() 里把失败吞成 undefined，不会毒化后续）。
   */
  private async withTimeout<T>(targetKey: string, task: () => Promise<T>): Promise<T> {
    if (this.taskTimeoutMs <= 0) return task();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        this.logger?.warn(`[reply-limiter] ${targetKey} 发送 ${this.taskTimeoutMs}ms 未返回，解除阻塞`);
        reject(new ReplyTimeoutError(targetKey, this.taskTimeoutMs));
      }, this.taskTimeoutMs);
      // 不要因为这条定时器把进程吊住
      timer.unref?.();
    });
    try {
      return await Promise.race([task(), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
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
      const value = await this.withTimeout(targetKey, task);
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

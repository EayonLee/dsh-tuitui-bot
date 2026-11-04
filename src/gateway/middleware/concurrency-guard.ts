/**
 * 并发守卫中间件 — 同一个 peer 上串行处理消息
 *
 * 同一个会话同时跑两轮 turn 会互相打断：流式输出抢同一个 msgid、会话上下文
 * 交错、工具调用互相覆盖。推推平台侧没有「同一会话只能一个流」的限制，
 * 所以这道闸只能自己加（不是为了绕开平台报错，而是为了
 * 会话正确性 —— 两个理由指向同一套状态机）。
 *
 * 四种策略（与上游一致）：
 *   - queue：后来的消息等前一条处理完（默认）
 *   - drop ：忙时静默丢弃
 *   - abort：中断当前这条，立刻处理新的
 *   - merge：忙时把新消息缓冲起来，当前这条处理完后合并成一条幸存 ctx，
 *            由幸存者自己 `next()` 继续往下走（非幸存者静默返回，链自然停下）
 *
 * 并发键是 `${scope}:${targetId}`（单聊按对方账号、群按 group_id、帖子按 channel_id）。
 *
 * merge 的实现要点（上游的核心设计，照搬）：
 *   当前消息 A 立即全速跑；B/C/D 停在 promise 上**不调用 ctx.stop()**，
 *   等 A 跑完统一合并，选一个幸存者继续，其余等待者直接返回。
 *   这样 A 的延迟为 0、缓冲批次只处理一次、非幸存者不需要额外的 stop 标记。
 *
 * 与上游的差异：上游用 `ctx.abort()` 播 AbortSignal 来中断下游；本插件的
 * MiddlewareContext 契约里没有 signal，改用同等效果的两件事：
 *   1. `ctx.skip()` —— 让下游所有 pending 的 next() 立刻返回（链停住）；
 *   2. `onInterrupt` 回调 —— 由集成方接上 SessionManager 的 cancel，
 *      真正取消在飞的模型调用 / 工具执行。
 */
import type { Logger, Middleware, MiddlewareContext } from '../../types.ts';

export type ConcurrencyStrategy = 'queue' | 'drop' | 'abort' | 'merge';

export interface ConcurrencyGuardOptions {
  /** 忙时策略，默认 queue */
  strategy?: ConcurrencyStrategy;
  /** 按消息挑策略（覆盖 strategy）：比如群聊排队、私聊直接打断 */
  strategyFor?: (ctx: MiddlewareContext) => ConcurrencyStrategy;
  /**
   * 单条消息最长处理时长(ms)，超时中断并放行队列；0 = 不限（默认 0）。
   * 上限保护的是「模型卡死导致这个 peer 永久占锁」。
   */
  maxProcessingMs?: number;
  /** 每目标最大排队数（queue）/ 最大缓冲数（merge），默认 3 */
  maxQueue?: number;
  /** 被丢弃时回调（drop 或溢出） */
  onDrop?: (ctx: MiddlewareContext) => void | Promise<void>;
  /** merge 策略的合并函数，必须返回缓冲数组中的一个作为幸存者 */
  onMerge?: (buffered: MiddlewareContext[]) => MiddlewareContext;
  /** @deprecated 上游遗留：合并后走回调派发，而不是幸存者自己 next() */
  onDispatch?: (ctx: MiddlewareContext) => void | Promise<void>;
  /** 紧急消息探针（如 /stop）：跳过缓冲直接并行处理，并清掉已缓冲的消息 */
  urgentPredicate?: (ctx: MiddlewareContext) => boolean;
  /** 中断当前处理时的回调（接 manager.cancel），reason 用于日志与排查 */
  onInterrupt?: (ctx: MiddlewareContext, reason: string) => void | Promise<void>;
  logger?: Logger;
}

interface MergeWaiter {
  ctx: MiddlewareContext;
  resolve: () => void;
  markSurvivor: () => void;
}

interface QueueEntry {
  run: () => void;
  ctx?: MiddlewareContext;
}

interface TargetState {
  busy: boolean;
  activeCtx?: MiddlewareContext;
  queue: QueueEntry[];
  mergeBuffer?: MiddlewareContext[];
  mergeWaiters?: MergeWaiter[];
}

export function concurrencyGuard(options: ConcurrencyGuardOptions = {}): Middleware {
  const defaultStrategy = options.strategy ?? 'queue';
  const maxQueue = options.maxQueue ?? 3;
  const maxProcessingMs = options.maxProcessingMs ?? 0;
  const log = options.logger;
  const locks = new Map<string, TargetState>();

  function getState(key: string): TargetState {
    let state = locks.get(key);
    if (!state) {
      state = { busy: false, queue: [] };
      locks.set(key, state);
    }
    return state;
  }

  /** 目标彻底空闲时删掉状态，避免攻击者用大量不同的 targetId 撑爆 Map */
  function cleanupState(key: string): void {
    const state = locks.get(key);
    if (
      state
      && !state.busy
      && state.queue.length === 0
      && (!state.mergeBuffer || state.mergeBuffer.length === 0)
    ) {
      locks.delete(key);
    }
  }

  function targetKey(ctx: MiddlewareContext): string {
    return `${ctx.replyTarget.scope}:${ctx.replyTarget.targetId}`;
  }

  /** 中断一条正在处理的消息：先停链（skip），再交给集成方真正取消 */
  async function interrupt(ctx: MiddlewareContext, reason: string): Promise<void> {
    ctx.skip(reason);
    try {
      await options.onInterrupt?.(ctx, reason);
    } catch (err) {
      log?.error(`[concurrency] onInterrupt 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 排空 merge 缓冲：合并成一条幸存 ctx，标给等待者，再由幸存者自己 next()。
   */
  async function drainMergeBuffer(
    key: string,
    state: TargetState,
    ownerCtx: MiddlewareContext,
  ): Promise<void> {
    while (state.mergeBuffer && state.mergeBuffer.length > 0) {
      const buffered = state.mergeBuffer.splice(0);
      const waiters = state.mergeWaiters?.splice(0) ?? [];

      const survivor = options.onMerge ? options.onMerge(buffered) : defaultMerge(buffered);
      const first = buffered[0] as MiddlewareContext;
      const validSurvivor: MiddlewareContext = buffered.includes(survivor) ? survivor : first;
      log?.debug(`[concurrency:merge] 合并批次: ${key}（count=${buffered.length}）`);

      if (options.onDispatch) {
        // 上游遗留路径：由回调直接派发，所有等待者都不是幸存者
        state.activeCtx = validSurvivor;
        try {
          await options.onDispatch(validSurvivor);
        } catch (err) {
          log?.error(
            `[concurrency:merge] onDispatch 失败: ${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          state.activeCtx = undefined;
        }
        for (const waiter of waiters) waiter.resolve();
      } else {
        for (const waiter of waiters) {
          if (waiter.ctx === validSurvivor) waiter.markSurvivor();
          waiter.resolve();
        }
      }
    }
    state.mergeBuffer = undefined;
    state.mergeWaiters = undefined;
    void ownerCtx;
  }

  function drainQueue(key: string): void {
    const state = locks.get(key);
    if (!state) return;
    const entry = state.queue.shift();
    if (entry) {
      entry.run();
    } else if (!state.busy) {
      locks.delete(key);
    }
  }

  /** abort 策略用：把自己排在队首，等当前这条释放 */
  function waitForRelease(state: TargetState, ctx: MiddlewareContext): Promise<void> {
    if (!state.busy) return Promise.resolve();
    return new Promise<void>((resolve) => {
      state.queue.unshift({ run: resolve, ctx });
    });
  }

  const guard: Middleware = async (ctx, next) => {
    const key = targetKey(ctx);
    const state = getState(key);
    // 策略可以按消息挑：群里排队、私聊直接打断——同一个 peer 的策略是稳定的
    const strategy = options.strategyFor?.(ctx) ?? defaultStrategy;

    // ── 空闲：自己就是 owner，直接跑 ──
    if (!state.busy) {
      state.busy = true;
      state.activeCtx = ctx;
      if (strategy === 'merge') {
        state.mergeBuffer = [];
        state.mergeWaiters = [];
      }

      let timedOut = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      if (maxProcessingMs > 0) {
        timeoutId = setTimeout(() => {
          timedOut = true;
          log?.warn(`[concurrency] ${key} 超过 ${maxProcessingMs}ms，中断当前处理`);
          // 先释放锁再排空队列：否则下一条消息把自己置 busy=true 会被这里的
          // 释放动作覆盖掉（上游踩过的坑，注释照搬）
          state.busy = false;
          state.activeCtx = undefined;
          void interrupt(ctx, 'concurrency:timeout');
          if (strategy === 'merge') {
            drainMergeBuffer(key, state, ctx).catch(() => {
              // 超时路径上的合并失败无需再上报：原始错误已经由 kernel 收敛
            });
          } else {
            drainQueue(key);
          }
          cleanupState(key);
        }, maxProcessingMs);
      }

      try {
        await next();
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (!timedOut) {
          state.activeCtx = undefined;
          if (strategy === 'merge') {
            await drainMergeBuffer(key, state, ctx);
            state.busy = false;
          } else {
            state.busy = false;
            if (strategy === 'queue' || strategy === 'abort') {
              drainQueue(key);
            }
          }
          cleanupState(key);
        }
      }
      return;
    }

    // ── 忙：按策略处理 ──
    switch (strategy) {
      case 'merge': {
        if (!state.mergeBuffer || !state.mergeWaiters) {
          state.mergeBuffer = [];
          state.mergeWaiters = [];
        }
        const mergeBuffer = state.mergeBuffer;
        const mergeWaiters = state.mergeWaiters;

        // 紧急消息（如 /stop）：把已缓冲的都放掉，自己立刻并行跑完剩余链
        if (options.urgentPredicate?.(ctx)) {
          log?.debug(`[concurrency:merge] 紧急消息插队: ${key}`);
          for (const waiter of mergeWaiters) waiter.resolve();
          mergeBuffer.length = 0;
          mergeWaiters.length = 0;
          await next();
          return;
        }

        if (mergeBuffer.length >= maxQueue) {
          log?.debug(`[concurrency:merge] 缓冲已满（${maxQueue}），丢弃: ${key}`);
          await options.onDrop?.(ctx);
          ctx.skip('concurrency:merge-full');
          return;
        }

        log?.debug(
          `[concurrency:merge] 缓冲消息: ${key}（msgId=${ctx.message.messageId} `
          + `pos=${mergeBuffer.length + 1}）`,
        );

        // 挂起但不 stop：等批次被处理。幸存者继续 next()，其余返回即停链。
        mergeBuffer.push(ctx);
        let isSurvivor = false;
        await new Promise<void>((resolve) => {
          mergeWaiters.push({
            ctx,
            resolve,
            markSurvivor: () => {
              isSurvivor = true;
            },
          });
        });
        if (isSurvivor) {
          await next();
        }
        return;
      }

      case 'drop': {
        log?.debug(`[concurrency] 目标忙，丢弃消息: ${key}`);
        await options.onDrop?.(ctx);
        ctx.skip('concurrency:drop');
        return;
      }

      case 'abort': {
        log?.debug(`[concurrency] 中断前一条，处理新消息: ${key}`);
        if (state.activeCtx) {
          await interrupt(state.activeCtx, 'concurrency:abort');
        }
        // 队列里等着的一律作废并放行，让它们各自继续/结束，避免悬挂
        const pending = state.queue.splice(0);
        for (const entry of pending) {
          if (entry.ctx) entry.ctx.skip('concurrency:superseded');
          entry.run();
        }
        await waitForRelease(state, ctx);
        if (ctx.skipped !== undefined) {
          log?.debug(`[concurrency] 等待期间被取代，放弃处理: ${key}`);
          return;
        }
        state.busy = true;
        state.activeCtx = ctx;
        try {
          await next();
        } finally {
          state.busy = false;
          state.activeCtx = undefined;
          drainQueue(key);
        }
        return;
      }

      case 'queue':
      default: {
        if (state.queue.length >= maxQueue) {
          // 用 warn：被丢掉的消息是"机器人没回"的真凶之一，debug 级在文件日志里看不见
          log?.warn(`[concurrency] 队列已满（${maxQueue}），丢弃: ${key}`);
          await options.onDrop?.(ctx);
          ctx.skip('concurrency:queue-full');
          return;
        }
        log?.debug(`[concurrency] 排队: ${key}（pos=${state.queue.length + 1}）`);
        await new Promise<void>((resolve) => {
          state.queue.push({ run: resolve, ctx });
        });
        state.busy = true;
        state.activeCtx = ctx;
        try {
          await next();
        } finally {
          state.busy = false;
          state.activeCtx = undefined;
          drainQueue(key);
        }
        return;
      }
    }
  };

  return guard;
}

/**
 * 默认合并：保留第一条，把后续正文按行拼接，envelope 与附件一并汇聚。
 * 这样「连发三句话」在模型眼里等价于一段话，而不是三轮互相打断的对话。
 */
function defaultMerge(buffered: MiddlewareContext[]): MiddlewareContext {
  const first = buffered[0];
  if (!first) throw new Error('concurrency-guard: 空批次无法合并');
  if (buffered.length === 1) return first;

  const withContent = buffered.filter((ctx) => (ctx.message.content ?? '') !== '');

  const contents = withContent.map((ctx) => ctx.message.content);
  if (contents.length > 0) {
    first.message.content = contents.join('\n');
  }

  const envelopes = withContent
    .map((ctx) => ctx.state.envelope)
    .filter((value): value is string => typeof value === 'string' && value !== '');
  if (envelopes.length > 0) {
    first.state.envelope = envelopes.join('\n\n');
  }

  const attachments = withContent.flatMap((ctx) => ctx.message.attachments ?? []);
  if (attachments.length > 0) {
    first.message.attachments = attachments;
  }

  return first;
}

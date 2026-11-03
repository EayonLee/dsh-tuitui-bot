/**
 * 中间件内核 — 洋葱模型 + skip 语义 + 兜底日志
 *
 * 上游这套逻辑由 SDK 提供（`runMiddlewareChain` / `createMiddlewareContext`），
 * 本插件没有 SDK 可依赖，于是原地复刻成一个可实例化的内核：网关启动时只需
 * 按上游相同顺序 `use()`，再对每条入站消息 `dispatch(ctx)`。
 *
 * 与上游的两处差异（都是传输层替换，不改语义）：
 *   1. 上游内核把异常抛回 `bot.emit('error')`，由宿主决定是否上报；推推没有
 *      等价的总线，异常一旦抛出就会变成未捕获拒绝，所以在这里一次性吞掉并记
 *      错误日志 —— 等价于上游链首的 `errorHandler()` 中间件。
 *   2. 上游 `ctx.stop()` 后仍会逐层进入下游中间件（由各中间件自己检查），本实现
 *      与之一致：`dispatch` 在每层入口检查 `ctx.skipped`，命中即返回，因此
 *      `skip()` 之后所有 pending 的 `next()` 都会立即返回。
 */
import type {
  InboundMessage,
  Logger,
  Middleware,
  MiddlewareContext,
  ReplyTarget,
  TuituiSender,
} from '../../types.ts';

/**
 * 兜底 logger：没有注入 logger 时退化到宿主 console。
 *
 * 上游把这层错误交给 `bot.emit('error')`，宿主一定有人接；这里如果静默吞掉，
 * 线上排查就没有任何线索，所以宁可打 console 也要留下痕迹。
 */
const CONSOLE_LOGGER: Logger = {
  info: (msg, ...args) => console.info(`[tuitui-bot]${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[tuitui-bot]${msg}`, ...args),
  error: (msg, ...args) => console.error(`[tuitui-bot]${msg}`, ...args),
  debug: (msg, ...args) => console.debug(`[tuitui-bot]${msg}`, ...args),
};

/** 中间件链（洋葱模型） */
export class MiddlewareKernel {
  private readonly middlewares: Middleware[] = [];
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? CONSOLE_LOGGER;
  }

  /** 追加一层中间件，返回自身便于链式编排 */
  use(mw: Middleware): this {
    this.middlewares.push(mw);
    return this;
  }

  /** 已注册层数（诊断用） */
  get size(): number {
    return this.middlewares.length;
  }

  /**
   * 派发一条消息。
   *
   * 任何一层抛出的异常都在这里收敛：只记日志，绝不重新抛出，避免打断事件循环
   * 或让上一条消息的失败影响后续消息。
   */
  async dispatch(ctx: MiddlewareContext): Promise<void> {
    let index = -1;
    const run = async (i: number): Promise<void> => {
      // next() 被同一层重复调用说明中间件写错了，与上游一样直接报错（会被下面的
      // catch 收敛成日志，而不是让整条链静默跑两遍）。
      if (i <= index) throw new Error('next() called multiple times');
      index = i;
      // skip 之后不再进入任何下游层，pending 的 next() 在这里就返回了。
      if (ctx.skipped !== undefined) return;
      const fn = this.middlewares[i];
      if (!fn) return;
      await fn(ctx, () => run(i + 1));
    };

    try {
      await run(0);
    } catch (err) {
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      this.logger.error(`[middleware] 处理消息失败（已收敛，不影响后续消息）: ${detail}`);
    }
  }
}

/**
 * 构造一条消息的中间件上下文。
 *
 * 对应上游 SDK 的 `createMiddlewareContext`。`skip` 只记录第一次的原因，
 * 后续重复 skip 不覆盖，便于排查「到底被哪一层拦下」。
 */
export function createMiddlewareContext(params: {
  message: InboundMessage;
  replyTarget: ReplyTarget;
  bot: TuituiSender;
  state?: Record<string, unknown>;
}): MiddlewareContext {
  let skipped: string | undefined;
  const ctx: MiddlewareContext = {
    message: params.message,
    state: params.state ?? {},
    replyTarget: params.replyTarget,
    bot: params.bot,
    skip(reason: string): void {
      if (skipped === undefined) skipped = reason;
    },
    get skipped(): string | undefined {
      return skipped;
    },
  };
  return ctx;
}

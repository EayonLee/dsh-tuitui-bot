/**
 * 历史缓冲中间件 — 把最近的群聊 / 帖子消息留在内存里
 *
 * 模型要接住「上一句在聊什么」，就必须看到没有 @ 机器人的那些消息；
 * 本中间件静默地把每条消息记进按群（或按频道）分桶的环形缓冲，再把缓冲
 * 列表经 `ctx.state.history` 交给下游组装 prompt。
 *
 * 存储是可插拔的：默认内存实现，插件里由 features/history-store.ts 提供
 * 跨调用可见的单例（回复完成后要能 clear 掉，避免下次 @ 时重复组包）。
 */
import type { HistoryEntry, Logger, Middleware, MiddlewareContext } from '../../types.ts';

/** 可插拔存储后端 */
export interface HistoryStore {
  append(groupKey: string, entry: HistoryEntry, limit: number): void | Promise<void>;
  list(groupKey: string, limit: number): HistoryEntry[] | Promise<HistoryEntry[]>;
  clear?(groupKey: string): void | Promise<void>;
}

/** 默认内存实现：每桶一个环形缓冲，适合单进程部署 */
export class MemoryHistoryStore implements HistoryStore {
  private readonly buffers = new Map<string, HistoryEntry[]>();

  append(groupKey: string, entry: HistoryEntry, limit: number): void {
    let buf = this.buffers.get(groupKey);
    if (!buf) {
      buf = [];
      this.buffers.set(groupKey, buf);
    }
    // 按 msgid 去重：事件重投时不能把同一句话记两遍，否则 prompt 里会出现重复上下文
    if (buf.some((e) => e.messageId === entry.messageId)) return;
    buf.push(entry);
    if (buf.length > limit) {
      buf.splice(0, buf.length - limit);
    }
  }

  list(groupKey: string, limit: number): HistoryEntry[] {
    const buf = this.buffers.get(groupKey);
    if (!buf) return [];
    return buf.slice(-limit);
  }

  clear(groupKey: string): void {
    this.buffers.delete(groupKey);
  }

  /** 诊断：当前有多少个群/频道持有缓冲 */
  size(): number {
    return this.buffers.size;
  }
}

export interface HistoryBufferOptions {
  /** 每桶最多保留条数，默认 50 */
  limit?: number;
  /** 存储后端，默认 {@link MemoryHistoryStore} */
  store?: HistoryStore;
  /**
   * 上游中间件 skip 之后是否仍然记账，默认 true。
   * 历史缓冲的存在意义就是记录「没回应的那些话」，所以默认必须记。
   */
  recordOnSkip?: boolean;
  /** 分桶键推导，默认群按 groupId、帖子按 team/channel，单聊不记账 */
  groupKey?: (ctx: MiddlewareContext) => string | undefined;
  /**
   * 只加不删的镜像存储。
   *
   * 主存储会在回复后被清空（避免下一轮 prompt 重复灌旧消息），但智能判定需要
   * 一段连续上下文，于是同一条消息再往镜像里记一份，镜像永不清理。
   */
  mirrorStore?: HistoryStore;
  logger?: Logger;
}

/**
 * 默认分桶键（不含 appId 前缀；多账号场景由调用方用 historyGroupKey 包一层）。
 */
export function defaultHistoryKey(ctx: MiddlewareContext): string | undefined {
  const msg = ctx.message;
  if (msg.kind === 'group') return msg.groupId;
  if (msg.kind === 'post' && msg.post) return `${msg.post.teamId}/${msg.post.channelId}`;
  return undefined;
}

export function historyBuffer(options: HistoryBufferOptions = {}): Middleware {
  const limit = options.limit ?? 50;
  const store = options.store ?? new MemoryHistoryStore();
  const recordOnSkip = options.recordOnSkip ?? true;
  const getKey = options.groupKey ?? defaultHistoryKey;
  const log = options.logger;

  return async (ctx, next) => {
    const key = getKey(ctx);
    // 单聊没有「群上下文」可言，直接放行
    if (!key) {
      await next();
      return;
    }

    // 1. 先取出「上一条为止」的缓冲交给下游 —— 当前这条还不能算进历史，
    //    否则模型会把正在回答的这句话再读一遍。
    try {
      ctx.state.history = await store.list(key, limit);
    } catch (err) {
      log?.error(`[history-buffer] 读取历史失败: ${err instanceof Error ? err.message : String(err)}`);
      ctx.state.history = [];
    }

    // 2. 再把当前消息记进去，供下一条消息使用
    const entry: HistoryEntry = {
      senderId: ctx.message.senderId,
      senderName: ctx.message.senderName,
      content: ctx.message.content,
      timestamp: Date.parse(ctx.message.timestamp) || Date.now(),
      messageId: ctx.message.messageId,
    };
    try {
      await store.append(key, entry, limit);
      // 镜像照记不误：判定要看连续上下文，且镜像永不被 clear 清掉
      await options.mirrorStore?.append(key, entry, limit);
    } catch (err) {
      // 记账失败不能阻断消息处理：宁可这轮少点上下文，也别让用户没回应
      log?.error(`[history-buffer] 写入历史失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (ctx.skipped !== undefined && !recordOnSkip) {
      return;
    }

    await next();
  };
}

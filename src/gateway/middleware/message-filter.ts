/**
 * 消息过滤中间件 — 丢弃无效 / 重复 / 自回声消息
 *
 * 两件事合在一次处理里（与上游一致）：
 *   1. **自回声**：推推在某些场景下会把机器人自己发出的消息再作为入站事件推回来
 *      （尤其是群聊），不拦住就会自己回复自己，形成死循环。
 *   2. **去重**：事件重投 / 网关重连重叠时同一条消息可能到达两次，重复处理会
 *      让同一轮对话被触发两遍、并重复消耗额度。
 *
 * 去重只留 msgid + 过期时间，用「懒淘汰」而不是定时器：消息量有上限（maxSize），
 * 每次写入时顺手清理最老的一批即可，不需要额外的后台 timer 拖住进程退出。
 */
import type { Logger, Middleware } from '../../types.ts';

export interface MessageFilterOptions {
  /** 丢弃 `fromBot === true` 的消息，默认开启 */
  skipSelfEcho?: boolean;
  /** 去重配置；传 `false` 完全关闭 */
  dedup?: false | {
    /** msgid 保留时长(ms)，默认 5000 */
    windowMs?: number;
    /** 同时跟踪的 msgid 上限，默认 1000 */
    maxSize?: number;
    /** 注入时钟（单测用），默认 Date.now */
    now?: () => number;
  };
  logger?: Logger;
}

export function messageFilter(options: MessageFilterOptions = {}): Middleware {
  const skipSelfEcho = options.skipSelfEcho ?? true;
  const dedupOptions = options.dedup === false
    ? null
    : {
      windowMs: options.dedup?.windowMs ?? 5000,
      maxSize: options.dedup?.maxSize ?? 1000,
      now: options.dedup?.now ?? (() => Date.now()),
    };
  const seen = dedupOptions ? new Map<string, number>() : null;
  const log = options.logger;

  /** 超出容量时从最老的开始淘汰（Map 保持插入序，故顺序遍历即时间序） */
  function evict(now: number): void {
    if (!seen || !dedupOptions) return;
    if (seen.size <= dedupOptions.maxSize) return;
    for (const [key, ts] of seen) {
      // 已过窗口或仍超容量 → 淘汰；否则后面的只会更新，可以提前收工
      if (now - ts > dedupOptions.windowMs || seen.size > dedupOptions.maxSize) {
        seen.delete(key);
      } else {
        break;
      }
    }
  }

  return async (ctx, next) => {
    // 1. 自回声
    if (skipSelfEcho && ctx.message.fromBot === true) {
      log?.debug('[message-filter] 丢弃机器人自回声消息');
      ctx.skip('self-echo');
      return;
    }

    // 2. 去重
    if (seen && dedupOptions) {
      const id = ctx.message.messageId;
      if (!id) {
        await next();
        return;
      }
      const now = dedupOptions.now();
      const seenAt = seen.get(id);
      // 只有仍在窗口内的重复才算重复：回过期后同一条 msgid 再次出现
      // （例如客户端重发了一条一模一样的消息）应当照常处理。
      if (seenAt !== undefined && now - seenAt <= dedupOptions.windowMs) {
        log?.debug(`[message-filter] 丢弃重复消息 msgid=${id}`);
        ctx.skip('dedup');
        return;
      }
      seen.set(id, now);
      evict(now);
    }

    await next();
  };
}

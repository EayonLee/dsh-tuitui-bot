/**
 * 群/帖子历史存储共享模块
 *
 * historyBuffer 中间件需要一个跨调用可访问的 HistoryStore 实例，
 * 以便在回复完成后清空某群的历史缓存（避免下次 @ 时重复组包）。
 *
 * 上游直接用 QQ SDK 自带的 MemoryHistoryStore；推推 SDK 没有中间件层，
 * 因此这里保留同样的接口与内存实现——接口不变，多实例部署时换成 Redis 实现即可。
 */
import type { HistoryEntry } from '../types.ts';

/** 可插拔的历史存储后端（与上游 SDK 的 HistoryStore 同构） */
export interface HistoryStore {
  /** 追加一条记录（超过 limit 时丢弃最旧的） */
  append(groupKey: string, entry: HistoryEntry, limit: number): void;
  /** 取最近 limit 条（旧 → 新） */
  list(groupKey: string, limit: number): HistoryEntry[];
  /** 清空某个会话的历史 */
  clear(groupKey: string): void;
}

/**
 * 内存环形缓冲实现（单进程部署足够）。
 *
 * 按 messageId 去重：推推在断线重连时会重投未确认事件，重复入账会让模型
 * 看到两条一模一样的消息。
 */
export class MemoryHistoryStore implements HistoryStore {
  private readonly buffers = new Map<string, HistoryEntry[]>();

  public append(groupKey: string, entry: HistoryEntry, limit: number): void {
    let buf = this.buffers.get(groupKey);
    if (!buf) {
      buf = [];
      this.buffers.set(groupKey, buf);
    }
    if (buf.some((e) => e.messageId === entry.messageId)) return;
    buf.push(entry);
    if (buf.length > limit) {
      buf.splice(0, buf.length - limit);
    }
  }

  public list(groupKey: string, limit: number): HistoryEntry[] {
    const buf = this.buffers.get(groupKey);
    if (!buf) return [];
    return buf.slice(-limit);
  }

  public clear(groupKey: string): void {
    this.buffers.delete(groupKey);
  }

  /** 诊断：当前有历史的会话数 */
  public size(): number {
    return this.buffers.size;
  }
}

let _store: HistoryStore | null = null;

/** 获取共享历史存储（单例：中间件与出站清理必须看到同一份数据） */
export function getHistoryStore(): HistoryStore {
  if (!_store) _store = new MemoryHistoryStore();
  return _store;
}

/**
 * 用 appId 前缀隔离历史（同一进程挂多个机器人账号时互不串台）。
 *
 * peerId 由调用方决定：群聊是 group_id，团队帖子是 `teamId/channelId`。
 */
export function historyGroupKey(appId: string, peerId: string): string {
  return `${appId}:${peerId}`;
}

/** 清空某个会话的历史（回复后调用，避免下次 @ 时重复组包） */
export function clearGroupHistory(appId: string, peerId: string): void {
  _store?.clear(historyGroupKey(appId, peerId));
}

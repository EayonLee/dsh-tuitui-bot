/**
 * 群/帖子历史存储共享模块
 *
 * historyBuffer 中间件需要一个跨调用可访问的 HistoryStore 实例，
 * 以便在回复完成后清空某群的历史缓存（避免下次 @ 时重复组包）。
 *
 * 推推 SDK 没有中间件层，历史缓冲由本插件自己维护，因此这里给出一套接口 +
 * 内存实现——接口不变，多实例部署时换成 Redis 实现即可。
 */
import type { HistoryEntry } from '../types.ts';

/** 可插拔的历史存储后端 */
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
let _judgeStore: HistoryStore | null = null;

/**
 * 「已经交给模型看过」的水位线：会话键 → 最后一条已投递的 messageId。
 *
 * 为什么要有它：以前的做法是回复完把整桶历史清掉，结果每次 @ 只能看到
 * 上次回复之后的那几条（实测 0~19 条），设置里的 50 条永远凑不满。
 * 改成水位线后缓冲一直滚动保留最近 N 条，注入时只取水位线之后的新消息——
 * 既不会重复灌旧内容，又能真的看到一整窗上下文。
 */
const delivered = new Map<string, string>();

/** 获取共享历史存储（单例：中间件与出站清理必须看到同一份数据） */
export function getHistoryStore(): HistoryStore {
  if (!_store) _store = new MemoryHistoryStore();
  return _store;
}

/**
 * 判定专用的历史存储（只加不删）。
 *
 * 普通历史在回复完就被 `clearGroupHistory` 清掉——那是为了不让下一轮 prompt
 * 重复灌一遍旧群聊。但智能判定要看的就是「刚才你们在聊什么」，跟着一起被清空
 * 的话，每轮判定只能看到上一条消息，判断自然发傻。所以判定单独留一份环形缓冲。
 */
export function getJudgeHistoryStore(): HistoryStore {
  if (!_judgeStore) _judgeStore = new MemoryHistoryStore();
  return _judgeStore;
}

/** 测试用：清掉单例，避免用例之间互相污染 */
export function resetHistoryStores(): void {
  _store = null;
  _judgeStore = null;
  delivered.clear();
}

/**
 * 用 appId 前缀隔离历史（同一进程挂多个机器人账号时互不串台）。
 *
 * peerId 由调用方决定：群聊是 group_id，团队帖子是 `teamId/channelId`。
 */
export function historyGroupKey(appId: string, peerId: string): string {
  return `${appId}:${peerId}`;
}

/** 清空某个会话的历史（保留给测试与手动运维；正常流程已改用水位线） */
export function clearGroupHistory(appId: string, peerId: string): void {
  _store?.clear(historyGroupKey(appId, peerId));
  delivered.delete(historyGroupKey(appId, peerId));
}

/** 记下「这条以及之前的都已经给模型看过了」 */
export function markHistoryDelivered(appId: string, peerId: string, messageId: string): void {
  delivered.set(historyGroupKey(appId, peerId), messageId);
}

/** 取水位线（没投递过返回 undefined） */
export function getHistoryDelivered(appId: string, peerId: string): string | undefined {
  return delivered.get(historyGroupKey(appId, peerId));
}

/**
 * 从缓冲里挑出「还没投递过」的那一段。
 *
 * 水位线那条消息本身也算已投递（它是上一次注入的最后一条），所以从它之后开始截。
 * 水位线已经滚出缓冲（说明聊了很久）时，按整窗返回。
 */
export function undeliveredHistory(
  entries: HistoryEntry[],
  watermark: string | undefined,
): HistoryEntry[] {
  if (watermark === undefined) return entries;
  const index = entries.findIndex((entry) => entry.messageId === watermark);
  if (index === -1) return entries;
  return entries.slice(index + 1);
}

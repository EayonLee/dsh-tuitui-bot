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
export declare class MemoryHistoryStore implements HistoryStore {
    private readonly buffers;
    append(groupKey: string, entry: HistoryEntry, limit: number): void;
    list(groupKey: string, limit: number): HistoryEntry[];
    clear(groupKey: string): void;
    /** 诊断：当前有历史的会话数 */
    size(): number;
}
/** 获取共享历史存储（单例：中间件与出站清理必须看到同一份数据） */
export declare function getHistoryStore(): HistoryStore;
/**
 * 判定专用的历史存储（只加不删）。
 *
 * 普通历史在回复完就被 `clearGroupHistory` 清掉——那是为了不让下一轮 prompt
 * 重复灌一遍旧群聊。但智能判定要看的就是「刚才你们在聊什么」，跟着一起被清空
 * 的话，每轮判定只能看到上一条消息，判断自然发傻。所以判定单独留一份环形缓冲。
 */
export declare function getJudgeHistoryStore(): HistoryStore;
/** 测试用：清掉单例，避免用例之间互相污染 */
export declare function resetHistoryStores(): void;
/**
 * 用 appId 前缀隔离历史（同一进程挂多个机器人账号时互不串台）。
 *
 * peerId 由调用方决定：群聊是 group_id，团队帖子是 `teamId/channelId`。
 */
export declare function historyGroupKey(appId: string, peerId: string): string;
/** 清空某个会话的历史（回复后调用，避免下次 @ 时重复组包） */
export declare function clearGroupHistory(appId: string, peerId: string): void;
//# sourceMappingURL=history-store.d.ts.map
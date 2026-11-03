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
export declare class MemoryHistoryStore implements HistoryStore {
    private readonly buffers;
    append(groupKey: string, entry: HistoryEntry, limit: number): void;
    list(groupKey: string, limit: number): HistoryEntry[];
    clear(groupKey: string): void;
    /** 诊断：当前有多少个群/频道持有缓冲 */
    size(): number;
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
    logger?: Logger;
}
/**
 * 默认分桶键（不含 appId 前缀；多账号场景由调用方用 historyGroupKey 包一层）。
 */
export declare function defaultHistoryKey(ctx: MiddlewareContext): string | undefined;
export declare function historyBuffer(options?: HistoryBufferOptions): Middleware;
//# sourceMappingURL=history-buffer.d.ts.map
import type { InboundAttachment, Logger, Middleware, MiddlewareContext } from '../../types.ts';
/** 索引里每条消息的摘要 */
export interface RefEntry {
    messageId: string;
    senderId: string;
    senderName?: string;
    content: string;
    timestamp: string;
    /** 允许业务方塞入额外元数据 */
    [key: string]: unknown;
}
/** 可插拔索引后端 */
export interface RefIndexStore {
    get(key: string): RefEntry | undefined | Promise<RefEntry | undefined>;
    set(key: string, entry: RefEntry): void | Promise<void>;
}
/** 解析结果（写入 `ctx.state.quote`） */
export interface ResolvedQuote {
    /** 解析用的键：内联引用用 sharedPostId / 'inline'，索引命中用其键 */
    refKey: string;
    /** 数据来源：事件体内联 / 本地索引 / 无 */
    source: 'reference' | 'store' | 'none';
    /** 供 prompt 使用的文本（已截断） */
    text: string;
    senderId?: string;
    senderName?: string;
    attachments?: InboundAttachment[];
}
export interface QuoteRefOptions {
    /** 索引后端，默认内存 LRU */
    store?: RefIndexStore;
    /** 默认内存 LRU 容量，默认 500 */
    maxSize?: number;
    /** 每条记录 / 引用文本的截断长度，默认 500 */
    contentLimit?: number;
    /** 优先使用事件体内联引用（等价上游 preferMsgElements），默认 true */
    preferMsgElements?: boolean;
    /** 写入前补充字段 */
    enrichEntry?: (entry: RefEntry, ctx: MiddlewareContext) => RefEntry;
    logger?: Logger;
}
/** 默认内存索引：写满后按插入序淘汰最老的（Map 天然保序） */
export declare class MemoryRefIndexStore implements RefIndexStore {
    private readonly map;
    private readonly maxSize;
    constructor(maxSize?: number);
    get(key: string): RefEntry | undefined;
    set(key: string, entry: RefEntry): void;
}
export declare function quoteRef(options?: QuoteRefOptions): Middleware;
//# sourceMappingURL=quote-ref.d.ts.map
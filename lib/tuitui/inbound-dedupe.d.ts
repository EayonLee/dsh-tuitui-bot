export interface InboundDedupeOptions {
    /** 落盘路径；传 undefined 表示只在内存里去重（单测/无 profile 场景） */
    path?: string;
    /** 最多记多少条，默认 1000 */
    limit?: number;
    /** 落盘失败回调（不能因为写盘失败影响收消息） */
    onError?: (message: string) => void;
}
export declare class InboundDedupe {
    private readonly path?;
    private readonly limit;
    private readonly onError?;
    /** 顺序数组 + 集合：数组管淘汰顺序，集合管 O(1) 命中 */
    private order;
    private seen;
    constructor(options?: InboundDedupeOptions);
    /** 这条消息是不是已经处理过 */
    has(messageId: string | undefined): boolean;
    /**
     * 标记为已处理。
     *
     * 返回 true 表示「这次是新的」（可以继续处理），false 表示重复。
     * 先判后记做成一个动作，避免调用方写成两行后漏掉其中一行。
     */
    claim(messageId: string | undefined): boolean;
    /** 当前记了多少条（排查用） */
    get size(): number;
    private load;
    private persist;
}
//# sourceMappingURL=inbound-dedupe.d.ts.map
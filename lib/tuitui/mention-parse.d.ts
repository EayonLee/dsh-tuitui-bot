/**
 * 解析正文里的 @。
 *
 * @param text 待发送的正文（Markdown）
 * @param options.self 自己的名字，出现 `@自己` 时忽略（没必要 @ 自己）
 * @param options.max 最多返回几个，默认 5
 */
export declare function extractMentions(text: string, options?: {
    self?: string;
    max?: number;
}): string[];
/** 合并显式 at 与正文解析结果（显式优先，去重，限流） */
export declare function mergeMentions(explicit: string[] | undefined, text: string, options?: {
    self?: string;
}): string[];
//# sourceMappingURL=mention-parse.d.ts.map
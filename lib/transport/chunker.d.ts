/**
 * Markdown 文本切分器
 *
 * 推推单条文本有字符数上限（保守取 4000），需要在合适边界切分，
 * 并保持 GFM 表格、代码块的完整性——推推客户端同样渲染 Markdown，
 * 把代码块劈成两半会让后一半整段退化成纯文本，比切长更难读。
 */
/**
 * 按换行边界切分 Markdown 文本
 * - 不在代码块中间断开
 * - 不在 GFM 表格中间断开
 * - 优先在空行处断开
 */
export declare function chunkMarkdownText(text: string, limit: number): string[];
//# sourceMappingURL=chunker.d.ts.map
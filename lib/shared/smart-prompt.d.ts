/**
 * 智能插话判定的出厂提示词。
 *
 * 单独放一份、不依赖任何运行时（llm/网络）：设置页要展示它、config 要拿它当
 * 默认值、判定逻辑要拿它兜底。三处共用同一份文本，避免各写一遍然后漂移。
 */
export declare const DEFAULT_SMART_PROMPT: string;
//# sourceMappingURL=smart-prompt.d.ts.map
/**
 * 智能插话判定的出厂提示词。
 *
 * 单独放一份、不依赖任何运行时（llm/网络）：设置页要展示它、config 要拿它当
 * 默认值、判定逻辑要拿它兜底。三处共用同一份文本，避免各写一遍然后漂移。
 *
 * 写法上刻意不给「判断清单」：一旦写成规则，它就是个按表格打勾的机器人。
 * 这里给的是处境和动机——兴趣、情绪、无聊、手上有东西——让它自己拿主意。
 * 回话方式也给三档：说话 / 挂表情 / 不理，别让「不回」变成唯一的沉默选项。
 */
export declare const DEFAULT_SMART_PROMPT: string;
/**
 * 老版本把「只输出一行 JSON」写进了提示词正文。
 *
 * 那份文本很可能已经被用户保存过（设置页把整段存进了配置），而协议现在改由
 * 工具 schema 下发——正文里留着这几行会跟工具调用打架。这里只剥掉协议段，
 * 其余性格描述原样保留。
 */
export declare function stripLegacyProtocol(prompt: string): string;
//# sourceMappingURL=smart-prompt.d.ts.map
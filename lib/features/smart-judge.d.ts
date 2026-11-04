import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { type SmartJudgeResult } from '../shared/join-decision.ts';
import type { Logger } from '../types.ts';
/** llm 服务最小接口（与 media/vision-tool 保持一致的收窄） */
interface LlmRuntimeLike {
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
/** 一条群聊记录（只留判断需要的最小信息） */
export interface JudgeLine {
    /** 说话人显示名 */
    sender: string;
    /** 文本内容（已清洗） */
    text: string;
    /** 是否是机器人自己发的 */
    self?: boolean;
}
export interface SmartJudgeOptions {
    /** ctx.llm 服务；不可用时直接判否 */
    llm: LlmRuntimeLike | undefined;
    /** 本次判定使用的模型路线 */
    route: {
        provider: string;
        model: string;
    } | undefined;
    /** 最近的对话（按时间正序，不含本条） */
    history: readonly JudgeLine[];
    /** 最新一条待判断的消息 */
    message: JudgeLine;
    /** 自定义判定提示词（设置页可编辑）；空则用 DEFAULT_SMART_PROMPT */
    prompt?: string;
    /** 超时毫秒（默认 8000） */
    timeoutMs?: number;
    /** 输出上限 token（默认 120） */
    maxTokens?: number;
    /** 同会话冷却键（群 id）；给了 cooldownMs 才生效 */
    cooldownKey?: string;
    /** 冷却毫秒（默认 20000） */
    cooldownMs?: number;
    logger?: Logger;
}
export type { SmartJudgeAct, SmartJudgeResult } from '../shared/join-decision.ts';
/** 清空冷却表（测试 / 重载时用） */
export declare function clearSmartJudgeCooldowns(): void;
export { DEFAULT_SMART_PROMPT } from '../shared/smart-prompt.ts';
/**
 * 判断一条消息要不要插嘴。
 *
 * 失败语义：任何异常/超时/服务缺失都返回 join:false，调用方不需要 try/catch。
 */
export declare function judgeShouldJoin(options: SmartJudgeOptions): Promise<SmartJudgeResult>;
//# sourceMappingURL=smart-judge.d.ts.map
/**
 * 工具输出声明（dsh 的硬要求）。
 *
 * dsh 的 tools.register() 会校验 output: { schema, render }，缺了就直接抛
 * "must declare output { schema, render, presentationMeta? }"。我们以前只有
 * 视觉 / 发文件两个工具带了 output，其余七个（group / history / file / send /
 * teams / bot / draw）全被丢掉——启动日志里只有一行 warn，模型那边根本没这个
 * 工具，于是问「群里有谁」它只能回「没这个能力」。
 *
 * 这些工具的返回值结构各不相同、以后还会加字段，所以 schema 走宽松形态，
 * render 用通用摘要：给模型看的是人话，具体字段调用方照样能读到。
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
export interface ToolOutputDeclaration {
    schema: Record<string, unknown>;
    render: (args: unknown, value: unknown) => ContentBlock[];
}
/** 通用摘要：列出对象的前几个字段，数组只报长度 */
export declare function summarizeToolResult(value: unknown): string;
/**
 * 宽松的对象输出声明。
 *
 * 不写死 properties：不同 action 返回的字段差别很大，写死反而会在加字段时静默
 * 截断。additionalProperties: true 在 dsh 支持的 schema 子集里。
 */
export declare function jsonToolOutput(): ToolOutputDeclaration;
//# sourceMappingURL=tool-output.d.ts.map
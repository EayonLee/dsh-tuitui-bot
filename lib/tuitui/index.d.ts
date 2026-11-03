/**
 * 推推渠道适配层
 *
 * 这里是全插件唯一直接 import @qihoo/tuitui-bot-sdk 的地方：
 * gateway 组装客户端与事件订阅，transport/features/media 只依赖 TuituiSender 抽象。
 */
export { createTuituiClient, createSdkLogger, resolveEndpoints, extractMessageId, describeApiError } from './client.ts';
export { TuituiSenderImpl, toSdkTarget, renderCardAsText } from './sender.ts';
export { normalizeEvent, isMessageEvent, classifyMime } from './inbound.ts';
export { createAgentStepReporter, buildAgentContext, summarizeResult } from './agent-reporter.ts';
export { syncShortcutCommands, DEFAULT_SHORTCUTS } from './shortcut.ts';
export type { NormalizeOptions, MessageRenderer } from './inbound.ts';
export type { AgentStepReporter, ToolCallReport } from './agent-reporter.ts';
export type { TuituiSenderOptions } from './sender.ts';
//# sourceMappingURL=index.d.ts.map
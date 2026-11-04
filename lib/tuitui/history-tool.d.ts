/**
 * 内置 tuitui_history 工具 — 让机器人自己翻聊天记录。
 *
 * 场景：被人问「昨天那事谁说的」、要补上自己不在场时的那几句、
 * 或者想看某个群的来龙去脉。只读，不设闸。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { TuituiBotClient } from '@qihoo/tuitui-bot-sdk';
import type { Logger } from '../types.ts';
export declare const HISTORY_TOOL_NAME = "tuitui_history";
export declare function registerHistoryTool(ctx: Context, client: TuituiBotClient, logger: Logger): void;
//# sourceMappingURL=history-tool.d.ts.map
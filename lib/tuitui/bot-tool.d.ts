/**
 * 内置 tuitui_bot 工具 — 机器人管自己：看身份、改名字、换头像、配快捷指令、
 * 配工作台菜单。
 *
 * 只有 info / get_shortcuts 是只读；其余全是"把自己改成另一个样子"，
 * 改错了别人会认不出这个机器人，所以一律要 confirm。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { TuituiBotClient } from '@qihoo/tuitui-bot-sdk';
import type { Logger } from '../types.ts';
export declare const BOT_TOOL_NAME = "tuitui_bot";
export declare function registerBotTool(ctx: Context, client: TuituiBotClient, logger: Logger): void;
//# sourceMappingURL=bot-tool.d.ts.map
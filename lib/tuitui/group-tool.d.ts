/**
 * 内置 tuitui_group 工具 — 让机器人自己管群。
 *
 * 分两档，不是所有动作都让模型随便来：
 * - 读（群信息 / 成员 / 我在哪些群 / 某人在不在）：随便问，不设闸；
 * - 写（建群 / 拉人 / 踢人）：必须显式带 confirm: true，且工具描述里写明
 *   只有老板说过「执行」才能带。踢人和建群都是能惹事的动作，模型自作主张
 *   把人踢出去，比它不说话严重得多。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { TuituiBotClient } from '@qihoo/tuitui-bot-sdk';
import type { Logger } from '../types.ts';
export declare const GROUP_TOOL_NAME = "tuitui_group";
export declare function registerGroupTool(ctx: Context, client: TuituiBotClient, logger: Logger): void;
//# sourceMappingURL=group-tool.d.ts.map
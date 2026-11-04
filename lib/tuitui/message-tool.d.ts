/**
 * 内置 tuitui_send 工具 — 消息的"花样"版：强通知、电话报警、链接卡片、
 * 卡片页、富文本、撤回、改消息。
 *
 * 日常回话走正常发送链路，这里只补那些普通发文本表达不了的动作：
 * - 链接卡片 / 卡片页 / 富文本：只是换个格式，不设闸；
 * - 撤回、改消息：改的是已经发出去的东西，要 confirm；
 * - 强通知 / 电话报警：会真的响到人手机上，必须 confirm。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToTarget, TuituiBotClient } from '@qihoo/tuitui-bot-sdk';
import type { Logger } from '../types.ts';
export declare const SEND_TOOL_NAME = "tuitui_send";
/** "c2c:account" / "group:group_id" → SDK 目标；非法返回 undefined */
export declare function parseSendTarget(input: string | undefined): ToTarget | undefined;
export declare function registerSendTool(ctx: Context, client: TuituiBotClient, logger: Logger, resolveCurrentTarget: (agent: unknown) => ToTarget | undefined): void;
//# sourceMappingURL=message-tool.d.ts.map
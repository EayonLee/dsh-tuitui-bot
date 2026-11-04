/**
 * 内置 tuitui_file 工具 — 让机器人自己管文件。
 *
 * 分两类：
 * - 传/查（upload / query / batch_query）：low risk，不设闸；
 * - 文件空间（add_node / delete_node / add_file / list_*）：动的是别人也看得见的目录，
 *   增删要 confirm=true。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { TuituiBotClient } from '@qihoo/tuitui-bot-sdk';
import type { Logger } from '../types.ts';
export declare const FILE_TOOL_NAME = "tuitui_file";
export declare function registerFileTool(ctx: Context, client: TuituiBotClient, logger: Logger): void;
//# sourceMappingURL=file-tool.d.ts.map
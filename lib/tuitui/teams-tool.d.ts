/**
 * 内置 tuitui_teams 工具 — 团队频道（帖子区）的读写。
 *
 * 群里聊天是一回事，团队频道里的帖子是另一回事：频道有成员、公告、标签、
 * 帖子链（主帖 + 回复）。机器人被 @ 在帖子里时，得能自己把上下文捞出来，
 * 也得能接着回。
 *
 * 读一律放开；发帖 / 改帖 / 往频道传文件要 confirm——频道里是全组人，
 * 发出去就撤不回来了。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { TuituiBotClient } from '@qihoo/tuitui-bot-sdk';
import type { Logger } from '../types.ts';
export declare const TEAMS_TOOL_NAME = "tuitui_teams";
export declare function registerTeamsTool(ctx: Context, client: TuituiBotClient, logger: Logger): void;
//# sourceMappingURL=teams-tool.d.ts.map
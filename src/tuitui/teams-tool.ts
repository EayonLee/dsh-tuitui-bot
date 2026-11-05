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
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Logger } from '../types.ts';
import { jsonToolOutput } from './tool-output.ts';

export const TEAMS_TOOL_NAME = 'tuitui_teams';

const DESCRIPTION = [
  'Work with Tuitui team channels (posts area). Actions:',
  '- channel_info: channel name/description (channel_id)',
  '- channel_posts: recent posts in a channel (channel_id, limit, cursor)',
  '- post_chain: a post plus its replies (team_id, channel_id, post_id)',
  '- post_tags: available tags (channel_id)',
  '- members / member_names: team member list (team_id)',
  '- announcement: channel announcement (channel_id)',
  '- send_post: post to a channel (team_id, channel_id, text, optional parent_id/tag, confirm=true)',
  '- edit_post: rewrite a post (team_id, channel_id, post_id, text, confirm=true)',
  '- send_file: upload a file into a channel (team_id, channel_id, source_path, confirm=true)',
].join(' ');

interface ToolsRegistryLike {
  register(definition: unknown): unknown;
}

interface TeamsArgs {
  action?: string;
  team_id?: string;
  channel_id?: string;
  post_id?: string;
  text?: string;
  tag?: string;
  parent_id?: string;
  limit?: number;
  cursor?: string;
  source_path?: string;
  confirm?: boolean;
}

const CONFIRM_ACTIONS = new Set(['send_post', 'edit_post', 'send_file']);

function str(a: TeamsArgs, key: keyof TeamsArgs): string {
  const v = a[key];
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`tuitui_teams: ${key} 必填`);
  return v.trim();
}

function localPath(a: TeamsArgs): string {
  const abs = resolve(str(a, 'source_path'));
  if (!existsSync(abs)) throw new Error(`tuitui_teams: 文件不存在: ${abs}`);
  return abs;
}

export function registerTeamsTool(ctx: Context, client: TuituiBotClient, logger: Logger): void {
  const tools = ctx.get('tools') as ToolsRegistryLike | undefined;
  if (!tools?.register) {
    logger.warn('im-tuitui: tools 服务不可用，tuitui_teams 工具未注册');
    return;
  }

  const definition = {
    name: TEAMS_TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'channel_info', 'channel_posts', 'post_chain', 'post_tags',
            'members', 'member_names', 'announcement',
            'send_post', 'edit_post', 'send_file',
          ],
          description: 'Which teams operation to perform.',
        },
        team_id: { type: 'string', description: 'Team id.' },
        channel_id: { type: 'string', description: 'Channel id.' },
        post_id: { type: 'string', description: 'Post id (post_chain / edit_post).' },
        text: { type: 'string', description: 'Post body, Markdown supported.' },
        tag: { type: 'string', description: 'Post tag.' },
        parent_id: { type: 'string', description: 'Reply to this post id (send_post).' },
        limit: { type: 'integer', description: 'How many posts, 1-100 (default 20).' },
        cursor: { type: 'string', description: 'Paging cursor.' },
        source_path: { type: 'string', description: 'Local file path (send_file).' },
        confirm: { type: 'boolean', description: 'Required for send_post/edit_post/send_file.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: jsonToolOutput(),
    async execute(args: unknown): Promise<Record<string, unknown>> {
      const a = (args ?? {}) as TeamsArgs;
      const action = str(a, 'action');
      if (CONFIRM_ACTIONS.has(action) && a.confirm !== true) {
        throw new Error(`tuitui_teams: ${action} 会发到全组都看得见的频道，必须带 confirm=true（先跟老板确认）`);
      }

      switch (action) {
        case 'channel_info':
          return { action, info: await client.teams.getChannelInfo(str(a, 'channel_id')) };
        case 'channel_posts': {
          const limit = Math.min(Math.max(Math.trunc(Number(a.limit ?? 20)) || 20, 1), 100);
          const res = await client.teams.getChannelPosts(str(a, 'channel_id'), {
            limit,
            ...(typeof a.cursor === 'string' && a.cursor !== '' ? { cursor: a.cursor } : {}),
          });
          return { action, has_more: res.has_more ?? false, cursor: res.cursor ?? '', msgs: res.msgs ?? [] };
        }
        case 'post_chain': {
          const chain = await client.teams.getPostChainForAgent(
            str(a, 'team_id'), str(a, 'channel_id'), str(a, 'post_id'),
          );
          return { action, count: chain.length, chain };
        }
        case 'post_tags':
          return { action, tags: await client.teams.getChannelPostTags(str(a, 'channel_id')) };
        case 'members':
          return { action, members: await client.teams.getMembers(str(a, 'team_id')) };
        case 'member_names':
          return { action, names: await client.teams.getMemberNames(str(a, 'team_id')) };
        case 'announcement':
          return { action, announcement: await client.teams.getAnnouncement(str(a, 'channel_id')) };
        case 'send_post': {
          await client.teams.sendPost({
            teamId: str(a, 'team_id'),
            channelId: str(a, 'channel_id'),
            text: str(a, 'text'),
            ...(a.parent_id !== undefined ? { parentId: a.parent_id } : {}),
            ...(a.tag !== undefined ? { tag: a.tag } : {}),
          });
          logger.info('im-tuitui: tuitui_teams 发帖');
          return { action, done: true };
        }
        case 'edit_post': {
          await client.teams.editPost({
            teamId: str(a, 'team_id'),
            channelId: str(a, 'channel_id'),
            postId: str(a, 'post_id'),
            text: str(a, 'text'),
            ...(a.tag !== undefined ? { tag: a.tag } : {}),
          });
          logger.info(`im-tuitui: tuitui_teams 改帖 ${a.post_id}`);
          return { action, done: true };
        }
        case 'send_file': {
          await client.teams.sendFile({
            teamId: str(a, 'team_id'),
            channelId: str(a, 'channel_id'),
            source: localPath(a),
            ...(a.text !== undefined ? { text: a.text } : {}),
          });
          return { action, done: true };
        }
        default:
          throw new Error(`tuitui_teams: 不认识的 action: ${action}`);
      }
    },
  };

  tools.register(definition);
  logger.info('im-tuitui: tuitui_teams 工具已注册');
}

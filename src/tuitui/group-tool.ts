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

export const GROUP_TOOL_NAME = 'tuitui_group';

const DESCRIPTION = [
  'Manage Tuitui groups on behalf of the user. Actions:',
  '- info: group name/announcement (bot must already be in the group)',
  '- members: member list with account/name/role/is_bot',
  '- robot_in: every group this bot is in',
  '- user_is_in: which of the given groups the user and the bot share',
  '- create: create a new group (needs confirm=true)',
  '- member_add: add accounts to a group (needs confirm=true)',
  '- member_remove: remove accounts from a group (needs confirm=true)',
  'Read actions are free. Write actions are dangerous: only call them with confirm=true',
  'after the user explicitly said to do it, and state who is affected.',
].join(' ');

interface ToolsRegistryLike {
  register(definition: unknown): unknown;
}

interface GroupArgs {
  action?: string;
  group_id?: string;
  name?: string;
  owner?: string;
  members?: string[];
  user?: string;
  groups?: string[];
  confirm?: boolean;
}

const READ_ACTIONS = new Set(['info', 'members', 'robot_in', 'user_is_in']);
const WRITE_ACTIONS = new Set(['create', 'member_add', 'member_remove']);

function requireString(args: GroupArgs, field: keyof GroupArgs): string {
  const value = args[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`tuitui_group: ${field} 必填`);
  }
  return value.trim();
}

function requireList(args: GroupArgs, field: keyof GroupArgs): string[] {
  const value = args[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`tuitui_group: ${field} 需要非空数组`);
  }
  return value.map((item) => String(item).trim()).filter((item) => item !== '');
}

export function registerGroupTool(ctx: Context, client: TuituiBotClient, logger: Logger): void {
  const tools = ctx.get('tools') as ToolsRegistryLike | undefined;
  if (!tools?.register) {
    logger.warn('im-tuitui: tools 服务不可用，tuitui_group 工具未注册');
    return;
  }

  const definition = {
    name: GROUP_TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [...READ_ACTIONS, ...WRITE_ACTIONS],
          description: 'Which group operation to perform.',
        },
        group_id: { type: 'string', description: 'Target group id (info/members/member_add/member_remove).' },
        name: { type: 'string', description: 'Group name (create).' },
        owner: { type: 'string', description: 'Owner account (create).' },
        members: {
          type: 'array',
          items: { type: 'string' },
          description: 'Accounts to add/remove (member_add/member_remove) or initial members (create).',
        },
        user: { type: 'string', description: 'Account to look up (user_is_in).' },
        groups: {
          type: 'array',
          items: { type: 'string' },
          description: 'Candidate group ids to check (user_is_in).',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true for create/member_add/member_remove. Only after the user explicitly asked.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args: unknown): Promise<Record<string, unknown>> {
      const a = (args ?? {}) as GroupArgs;
      const action = requireString(a, 'action');

      if (!READ_ACTIONS.has(action) && !WRITE_ACTIONS.has(action)) {
        throw new Error(`tuitui_group: 不认识的 action: ${action}`);
      }
      if (WRITE_ACTIONS.has(action) && a.confirm !== true) {
        throw new Error(`tuitui_group: ${action} 会改动群成员，必须带 confirm=true（先跟老板确认）`);
      }

      switch (action) {
        case 'info': {
          const info = await client.group.info(requireString(a, 'group_id'));
          logger.info(`im-tuitui: tuitui_group info ${info.id}`);
          return { action, id: info.id, name: info.name, announce: info.announce ?? '' };
        }
        case 'members': {
          const members = await client.group.members(requireString(a, 'group_id'));
          return {
            action,
            count: members.length,
            members: members.map((m) => ({
              account: m.account,
              name: m.name,
              role: m.role,
              is_bot: m.is_bot === true,
            })),
          };
        }
        case 'robot_in': {
          const groups = await client.group.robotIn();
          return { action, count: groups.length, groups: groups.map((g) => ({ group_id: g.group_id, name: g.name })) };
        }
        case 'user_is_in': {
          const found = await client.group.userIsIn({
            user: requireString(a, 'user'),
            groups: requireList(a, 'groups'),
          });
          return { action, count: found.length, groups: found.map((g) => ({ group_id: g.group_id, name: g.name })) };
        }
        case 'create': {
          const created = await client.group.create({
            name: requireString(a, 'name'),
            owner: requireString(a, 'owner'),
            members: Array.isArray(a.members) ? a.members.map(String) : [],
          });
          logger.info(`im-tuitui: tuitui_group 建群 ${created.group_id}`);
          return { action, group_id: created.group_id };
        }
        case 'member_add': {
          const groupId = requireString(a, 'group_id');
          const members = requireList(a, 'members');
          await client.group.memberAdd(groupId, members);
          logger.info(`im-tuitui: tuitui_group 拉人 ${members.join(',')} → ${groupId}`);
          return { action, group_id: groupId, members, done: true };
        }
        case 'member_remove': {
          const groupId = requireString(a, 'group_id');
          const members = requireList(a, 'members');
          await client.group.memberRemove(groupId, members);
          logger.info(`im-tuitui: tuitui_group 移除 ${members.join(',')} ← ${groupId}`);
          return { action, group_id: groupId, members, done: true };
        }
        default:
          throw new Error(`tuitui_group: 不认识的 action: ${action}`);
      }
    },
  };

  tools.register(definition);
  logger.info('im-tuitui: tuitui_group 工具已注册');
}

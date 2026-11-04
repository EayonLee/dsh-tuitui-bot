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

export const BOT_TOOL_NAME = 'tuitui_bot';

const DESCRIPTION = [
  'Inspect or reconfigure this Tuitui bot itself. Actions:',
  '- info: bot name / uid / account',
  '- get_shortcuts: current shortcut commands',
  '- set_shortcuts: replace shortcut commands (commands: [{name,content,description,tag}], confirm=true)',
  '- set_name: rename the bot (name, confirm=true)',
  '- set_avatar: change avatar (url, confirm=true)',
  '- set_workspace_menus: replace workspace menus (menus: [{name,url,openMode,visibility}], confirm=true)',
  'Write actions are visible to every user of this bot: only after the owner explicitly asked.',
].join(' ');

interface ToolsRegistryLike {
  register(definition: unknown): unknown;
}

interface BotArgs {
  action?: string;
  name?: string;
  url?: string;
  avatar?: string;
  commands?: Array<{ name?: string; content?: string; description?: string; tag?: string }>;
  menus?: Array<{ name?: string; url?: string; openMode?: string; visibility?: string }>;
  confirm?: boolean;
}

const CONFIRM_ACTIONS = new Set(['set_shortcuts', 'set_name', 'set_avatar', 'set_workspace_menus']);

export function registerBotTool(ctx: Context, client: TuituiBotClient, logger: Logger): void {
  const tools = ctx.get('tools') as ToolsRegistryLike | undefined;
  if (!tools?.register) {
    logger.warn('im-tuitui: tools 服务不可用，tuitui_bot 工具未注册');
    return;
  }

  const definition = {
    name: BOT_TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['info', 'get_shortcuts', 'set_shortcuts', 'set_name', 'set_avatar', 'set_workspace_menus'],
          description: 'Which bot operation to perform.',
        },
        name: { type: 'string', description: 'New bot name (set_name).' },
        avatar: { type: 'string', description: 'Avatar url (set_avatar).' },
        url: { type: 'string', description: 'Menu url (set_workspace_menus).' },
        commands: {
          type: 'array',
          description: 'Shortcut commands to install (replaces the whole list).',
          items: { type: 'object', additionalProperties: true },
        },
        menus: {
          type: 'array',
          description: 'Workspace menus to install (replaces the whole list).',
          items: { type: 'object', additionalProperties: true },
        },
        confirm: { type: 'boolean', description: 'Required for every set_* action.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args: unknown): Promise<Record<string, unknown>> {
      const a = (args ?? {}) as BotArgs;
      const action = typeof a.action === 'string' ? a.action : '';
      if (CONFIRM_ACTIONS.has(action) && a.confirm !== true) {
        throw new Error(`tuitui_bot: ${action} 会改机器人对外形象，必须带 confirm=true（先跟老板确认）`);
      }

      switch (action) {
        case 'info': {
          const info = await client.property.info();
          return { action, name: info.name, uid: info.uid, account: info.account };
        }
        case 'get_shortcuts': {
          const commands = await client.property.getShortcutCommands();
          return { action, count: commands.length, commands };
        }
        case 'set_shortcuts': {
          const list = Array.isArray(a.commands) ? a.commands : [];
          if (list.length === 0) throw new Error('tuitui_bot: set_shortcuts 需要 commands');
          const payload = list.map((c) => ({
            name: String(c.name ?? ''),
            content: String(c.content ?? ''),
            description: String(c.description ?? ''),
            tag: String(c.tag ?? ''),
          }));
          await client.property.setShortcutCommands(payload);
          logger.info(`im-tuitui: tuitui_bot 快捷指令 ${payload.length} 条`);
          return { action, done: true, count: payload.length };
        }
        case 'set_name': {
          if (typeof a.name !== 'string' || a.name.trim() === '') throw new Error('tuitui_bot: name 必填');
          await client.property.setName(a.name.trim());
          logger.info(`im-tuitui: tuitui_bot 改名 ${a.name}`);
          return { action, done: true, name: a.name };
        }
        case 'set_avatar': {
          if (typeof a.avatar !== 'string' || a.avatar.trim() === '') throw new Error('tuitui_bot: avatar 必填');
          await client.property.setAvatar(a.avatar.trim());
          return { action, done: true };
        }
        case 'set_workspace_menus': {
          const list = Array.isArray(a.menus) ? a.menus : [];
          if (list.length === 0) throw new Error('tuitui_bot: set_workspace_menus 需要 menus');
          const payload = list.map((m) => ({
            name: String(m.name ?? ''),
            url: String(m.url ?? ''),
            openMode: String(m.openMode ?? 'single_tab'),
            visibility: m.visibility ?? null,
          }));
          await client.property.setWorkspaceMenus(payload);
          return { action, done: true, count: payload.length };
        }
        default:
          throw new Error(`tuitui_bot: 不认识的 action: ${action}`);
      }
    },
  };

  tools.register(definition);
  logger.info('im-tuitui: tuitui_bot 工具已注册');
}

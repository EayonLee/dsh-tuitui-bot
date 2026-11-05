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
import { jsonToolOutput } from './tool-output.ts';

export const SEND_TOOL_NAME = 'tuitui_send';

const DESCRIPTION = [
  'Send richer Tuitui messages than plain text. Actions:',
  '- link: url + title (+content/image)',
  '- page: a card page (title/content, optional summary/image); it is NOT stored in chat history,',
  '  so nobody (including you) can read it back later',
  '- mixed: text with inline images (items: [{type:"text",text}|{type:"image",source_path}])',
  '- recall: withdraw a message (needs message_id, confirm=true)',
  '- modify: edit a sent message text (needs message_id, confirm=true)',
  '- strong_notice: push a notice that must be seen (needs account + confirm=true).',
  '  Requires a separately granted API permission on the bot appId; without it the server answers',
  '  errcode 6, so do not retry or fall back—tell the user the permission has to be applied for',
  '- phone_alarm: phone/voice alarm (needs accounts or mobiles + confirm=true). Same separate',
  '  permission requirement as strong_notice',
  'Target as "c2c:account" or "group:group_id"; omit to use the current conversation.',
].join(' ');

interface ToolsRegistryLike {
  register(definition: unknown): unknown;
}

interface SendArgs {
  action?: string;
  target?: string;
  text?: string;
  title?: string;
  url?: string;
  summary?: string;
  image?: string;
  items?: Array<{ type?: string; text?: string; source_path?: string }>;
  message_id?: string;
  account?: string;
  accounts?: string[];
  mobiles?: string[];
  sms_notice?: boolean;
  call_notice?: boolean;
  confirm?: boolean;
}

const CONFIRM_ACTIONS = new Set(['recall', 'modify', 'strong_notice', 'phone_alarm']);

function str(a: SendArgs, key: keyof SendArgs): string {
  const v = a[key];
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`tuitui_send: ${key} 必填`);
  return v.trim();
}

/** "c2c:account" / "group:group_id" → SDK 目标；非法返回 undefined */
export function parseSendTarget(input: string | undefined): ToTarget | undefined {
  if (input === undefined || input === '') return undefined;
  const idx = input.indexOf(':');
  if (idx <= 0) return undefined;
  const scope = input.slice(0, idx);
  const id = input.slice(idx + 1);
  if (id === '') return undefined;
  if (scope === 'c2c') return { uids: [id] };
  if (scope === 'group') return { groupId: id };
  return undefined;
}

export function registerSendTool(
  ctx: Context,
  client: TuituiBotClient,
  logger: Logger,
  resolveCurrentTarget: (agent: unknown) => ToTarget | undefined,
): void {
  const tools = ctx.get('tools') as ToolsRegistryLike | undefined;
  if (!tools?.register) {
    logger.warn('im-tuitui: tools 服务不可用，tuitui_send 工具未注册');
    return;
  }

  const targetOf = (a: SendArgs, agent: unknown): ToTarget => {
    const explicit = parseSendTarget(a.target);
    const to = explicit ?? resolveCurrentTarget(agent);
    if (to === undefined) throw new Error('tuitui_send: 无法确定发送目标，请传 target（c2c:account 或 group:group_id）');
    return to;
  };

  const definition = {
    name: SEND_TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['link', 'page', 'mixed', 'recall', 'modify', 'strong_notice', 'phone_alarm'],
          description: 'Which message action to perform.',
        },
        target: { type: 'string', description: 'Send target "c2c:account" or "group:group_id".' },
        text: { type: 'string', description: 'Message text (modify / strong_notice / mixed).' },
        title: { type: 'string', description: 'Link or page title.' },
        url: { type: 'string', description: 'Link url.' },
        summary: { type: 'string', description: 'Page summary.' },
        image: { type: 'string', description: 'Image url for link/page.' },
        items: {
          type: 'array',
          description: 'Mixed items: {type:"text",text} or {type:"image",source_path}.',
          items: { type: 'object', additionalProperties: true },
        },
        message_id: { type: 'string', description: 'Message id (recall / modify).' },
        account: { type: 'string', description: 'Account for strong_notice.' },
        accounts: { type: 'array', items: { type: 'string' }, description: 'Accounts for phone_alarm.' },
        mobiles: { type: 'array', items: { type: 'string' }, description: 'Mobile numbers for phone_alarm.' },
        sms_notice: { type: 'boolean', description: 'strong_notice: also send sms.' },
        call_notice: { type: 'boolean', description: 'strong_notice: also call.' },
        confirm: { type: 'boolean', description: 'Required for recall/modify/strong_notice/phone_alarm.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: jsonToolOutput(),
    async execute(args: unknown, exec?: { agent?: unknown }): Promise<Record<string, unknown>> {
      const a = (args ?? {}) as SendArgs;
      const action = str(a, 'action');
      if (CONFIRM_ACTIONS.has(action) && a.confirm !== true) {
        throw new Error(`tuitui_send: ${action} 会惊动人/改动已发消息，必须带 confirm=true（先跟老板确认）`);
      }

      switch (action) {
        case 'link': {
          await client.im.sendLink({
            to: targetOf(a, exec?.agent),
            link: {
              url: str(a, 'url'),
              title: str(a, 'title'),
              ...(a.text !== undefined ? { content: a.text } : {}),
              ...(a.image !== undefined ? { image: a.image } : {}),
            },
          });
          return { action, done: true };
        }
        case 'page': {
          await client.im.sendPage({
            to: targetOf(a, exec?.agent),
            page: {
              title: str(a, 'title'),
              content: str(a, 'text'),
              ...(a.summary !== undefined ? { summary: a.summary } : {}),
              ...(a.image !== undefined ? { image: a.image } : {}),
            },
          });
          return { action, done: true };
        }
        case 'mixed': {
          const items = Array.isArray(a.items) ? a.items : [];
          if (items.length === 0) throw new Error('tuitui_send: mixed 需要 items');
          const payload = items.map((item) => {
            if (item.type === 'image') {
              const sourcePath = typeof item.source_path === 'string' ? item.source_path.trim() : '';
              if (sourcePath === '') throw new Error('tuitui_send: mixed 的图片项需要 source_path');
              return { type: 'image' as const, source: sourcePath };
            }
            return { type: 'text' as const, text: typeof item.text === 'string' ? item.text : '' };
          });
          await client.im.sendMixed({ to: targetOf(a, exec?.agent), items: payload });
          return { action, done: true, count: payload.length };
        }
        case 'recall': {
          await client.im.recall({ to: targetOf(a, exec?.agent), messageId: str(a, 'message_id') });
          logger.info(`im-tuitui: tuitui_send 撤回 ${a.message_id}`);
          return { action, done: true };
        }
        case 'modify': {
          await client.im.modifyText({ to: targetOf(a, exec?.agent), messageId: str(a, 'message_id'), text: str(a, 'text') });
          return { action, done: true };
        }
        case 'strong_notice': {
          await client.im.sendStrongNotice({
            account: str(a, 'account'),
            content: str(a, 'text'),
            smsNotice: a.sms_notice === true,
            callNotice: a.call_notice === true,
          });
          logger.info(`im-tuitui: tuitui_send 强通知 → ${a.account}`);
          return { action, done: true };
        }
        case 'phone_alarm': {
          const accounts = Array.isArray(a.accounts) ? a.accounts.map(String) : [];
          const mobiles = Array.isArray(a.mobiles) ? a.mobiles.map(String) : [];
          if (accounts.length === 0 && mobiles.length === 0) throw new Error('tuitui_send: phone_alarm 需要 accounts 或 mobiles');
          await client.im.sendPhoneAlarm({
            message: str(a, 'text'),
            ...(accounts.length > 0 ? { accounts } : {}),
            ...(mobiles.length > 0 ? { mobiles } : {}),
          });
          logger.info('im-tuitui: tuitui_send 电话报警');
          return { action, done: true };
        }
        default:
          throw new Error(`tuitui_send: 不认识的 action: ${action}`);
      }
    },
  };

  tools.register(definition);
  logger.info('im-tuitui: tuitui_send 工具已注册');
}

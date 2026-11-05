/**
 * 内置 tuitui_history 工具 — 让机器人自己翻聊天记录。
 *
 * 场景：被人问「昨天那事谁说的」、要补上自己不在场时的那几句、
 * 或者想看某个群的来龙去脉。只读，不设闸。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { TuituiBotClient } from '@qihoo/tuitui-bot-sdk';
import type { Logger } from '../types.ts';
import { jsonToolOutput } from './tool-output.ts';

export const HISTORY_TOOL_NAME = 'tuitui_history';

const DESCRIPTION = [
  'Read past Tuitui chat records. Actions:',
  '- group: messages of a group (needs group_id)',
  '- private: messages between the bot and one account (needs account)',
  'Optional: limit (default 20, max 100), cursor (from a previous call), order_asc (oldest first).',
  'Read-only; use it when someone refers to earlier conversation you did not see.',
].join(' ');

interface ToolsRegistryLike {
  register(definition: unknown): unknown;
}

interface HistoryArgs {
  action?: string;
  group_id?: string;
  account?: string;
  limit?: number;
  cursor?: string;
  order_asc?: boolean;
}

/** 消息体 → 一行文本（拿不到正文就退回类型名，别让整条记录消失） */
function describeMessage(client: TuituiBotClient, data: unknown): string {
  try {
    const text = client.event.renderMessageBody(data);
    if (typeof text === 'string' && text.trim() !== '') return text.trim();
  } catch {
    // 渲染失败不算错误：往下走，给个占位
  }
  const kind = (data as { msg_type?: string } | undefined)?.msg_type;
  return kind === undefined ? '[非文本消息]' : `[${kind}]`;
}

export function registerHistoryTool(ctx: Context, client: TuituiBotClient, logger: Logger): void {
  const tools = ctx.get('tools') as ToolsRegistryLike | undefined;
  if (!tools?.register) {
    logger.warn('im-tuitui: tools 服务不可用，tuitui_history 工具未注册');
    return;
  }

  const definition = {
    name: HISTORY_TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['group', 'private'], description: 'Which record to read.' },
        group_id: { type: 'string', description: 'Group id (action=group).' },
        account: { type: 'string', description: 'Peer account (action=private).' },
        limit: { type: 'integer', description: 'How many messages, 1-100 (default 20).' },
        cursor: { type: 'string', description: 'Paging cursor from a previous call.' },
        order_asc: { type: 'boolean', description: 'Oldest first when true.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: jsonToolOutput(),
    async execute(args: unknown): Promise<Record<string, unknown>> {
      const a = (args ?? {}) as HistoryArgs;
      const action = typeof a.action === 'string' ? a.action : '';
      if (action !== 'group' && action !== 'private') {
        throw new Error(`tuitui_history: action 只能是 group 或 private，收到: ${action}`);
      }
      const limit = Math.min(Math.max(Math.trunc(Number(a.limit ?? 20)) || 20, 1), 100);
      const options = {
        limit,
        ...(typeof a.cursor === 'string' && a.cursor !== '' ? { cursor: a.cursor } : {}),
        ...(a.order_asc === true ? { orderAsc: true } : {}),
      };

      if (action === 'group') {
        if (typeof a.group_id !== 'string' || a.group_id === '') throw new Error('tuitui_history: group_id 必填');
        const res = await client.im.getHistory(client.to.group(a.group_id), options);
        const msgs = (res.msgs ?? []) as Array<{ user_name?: string; user_account?: string; timestamp?: string; data?: unknown }>;
        return {
          action,
          has_more: res.has_more ?? false,
          cursor: res.cursor ?? '',
          count: msgs.length,
          messages: msgs.map((m) => ({
            from: m.user_name ?? m.user_account ?? '',
            time: m.timestamp ?? '',
            text: describeMessage(client, m.data),
          })),
        };
      }

      if (typeof a.account !== 'string' || a.account === '') throw new Error('tuitui_history: account 必填');
      const res = await client.im.getHistory(client.to.account(a.account), options);
      const msgs = (res.msgs ?? []) as Array<{ user_name?: string; user_account?: string; timestamp?: string; data?: unknown }>;
      return {
        action,
        has_more: res.has_more ?? false,
        cursor: res.cursor ?? '',
        count: msgs.length,
        messages: msgs.map((m) => ({
          from: m.user_name ?? m.user_account ?? '',
          time: m.timestamp ?? '',
          text: describeMessage(client, m.data),
        })),
      };
    },
  };

  tools.register(definition);
  logger.info('im-tuitui: tuitui_history 工具已注册');
}

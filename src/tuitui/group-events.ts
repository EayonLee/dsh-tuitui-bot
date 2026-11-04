/**
 * 群事件 → 一条"系统通知"。
 *
 * 被拉进群、被踢出群、群建好了——这些不是消息事件，normalizeEvent 解不出来。
 * 但机器人得知道：不然它在群里出现，自己都不知道自己怎么来的。
 *
 * 处理方式：写一条系统消息进判定历史（只加不删的那份），下一轮判定就能看到
 * "我 12:03 被李正泰拉进了群 X"。默认不主动在群里说话，免得一进群就刷屏。
 */
import type { HistoryStore } from '../features/history-store.ts';
import type { Logger } from '../types.ts';

export type GroupEventKind = 'group_create' | 'group_invite' | 'group_kick';

const NOTICE: Record<GroupEventKind, string> = {
  group_create: '群聊被创建',
  group_invite: '我被拉进了这个群',
  group_kick: '我被移出了这个群',
};

/** 事件体里各处可能叫 group_id / groupId / chat_id，取到一个算一个 */
function pickGroupId(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ['group_id', 'groupId', 'chat_id', 'chatId', 'id']) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  const nested = record.data;
  if (nested !== undefined && nested !== data) return pickGroupId(nested);
  return undefined;
}

function pickGroupName(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ['group_name', 'groupName', 'name']) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

export interface GroupEventResult {
  groupId?: string;
  text: string;
}

/**
 * 识别群事件并生成系统通知；不是群事件返回 undefined。
 *
 * @param event 推推事件名（body.event）
 * @param data  事件体（body.data）
 */
export function describeGroupEvent(event: string, data: unknown): GroupEventResult | undefined {
  if (event !== 'group_create' && event !== 'group_invite' && event !== 'group_kick') return undefined;
  const groupId = pickGroupId(data);
  const name = pickGroupName(data);
  const head = NOTICE[event];
  const text = name === undefined ? `[系统] ${head}` : `[系统] ${head}：${name}`;
  return groupId === undefined ? { text } : { groupId, text };
}

/** 把群事件写进判定历史（写不进去只记 warn，不影响主流程） */
export function recordGroupEvent(
  store: HistoryStore,
  key: string,
  notice: GroupEventResult,
  logger: Logger,
): void {
  try {
    store.append(key, {
      senderId: 'system',
      senderName: '系统',
      content: notice.text,
      timestamp: Date.now(),
      messageId: `sys-${notice.text}-${Date.now()}`,
    }, 50);
  } catch (error) {
    logger.warn(`[tuitui/group-event] 记录失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

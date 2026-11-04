/**
 * 表情回执的状态机。
 *
 * 之前的做法是在中间件里 `await next()` 之后直接换表情——但中间件链在
 * 「交给 agent」那一步就返回了，真正的回复是之后才发出去的。于是 ✅ 在机器人
 * 还没说话时就挂上了，看起来像假的。
 *
 * 现在改成：收到消息挂 👀 并在这里登记；真正的回复发出去时（sender 里）把
 * 👀 撤掉换 ✅；出错换 😵；一轮结束什么都没发（判定为不说话）就把 👀 撤掉。
 *
 * 缺一条消息 id 就不登记，不登记就什么都不做——回执永远是可选装饰。
 */
import type { ReplyTarget, TuituiSender } from '../types.ts';

export interface ReceiptEntry {
  bot: TuituiSender;
  target: ReplyTarget;
  msgId: string;
  done: string;
  fail: string;
}

const pending = new Map<string, ReceiptEntry>();

function keyOf(target: ReplyTarget, msgId: string): string {
  return `${target.scope}:${target.targetId}:${msgId}`;
}

/** 收到消息：登记一个待兑现的回执（同一个 msgid 重复登记以最后一次为准） */
export function registerReceipt(entry: ReceiptEntry): void {
  pending.set(keyOf(entry.target, entry.msgId), entry);
}

/** 有没有这笔待兑现的回执（测试 / 诊断用） */
export function hasReceipt(target: ReplyTarget, msgId: string): boolean {
  return pending.has(keyOf(target, msgId));
}

/** 测试用：清空登记表 */
export function resetReceipts(): void {
  pending.clear();
}

/**
 * 兑现回执。
 *
 * @param outcome done 回复已发出 / fail 处理出错 / none 这一轮不说话
 * @param messageId 指定 msgid（sender 知道自己在回哪条）；省略则按 target 找最近的一条
 */
export async function settleReceipt(
  target: ReplyTarget,
  outcome: 'done' | 'fail' | 'none',
  messageId?: string,
): Promise<void> {
  const key = messageId === undefined ? undefined : keyOf(target, messageId);
  let entry: ReceiptEntry | undefined;
  if (key !== undefined) {
    entry = pending.get(key);
    if (entry !== undefined) pending.delete(key);
  } else {
    // 按 target 找：一轮里通常只有一条待兑现的回执
    for (const [k, value] of pending) {
      if (value.target.scope === target.scope && value.target.targetId === target.targetId) {
        entry = value;
        pending.delete(k);
        break;
      }
    }
  }
  if (entry === undefined) return;

  const emoji = outcome === 'done' ? entry.done : outcome === 'fail' ? entry.fail : '';
  try {
    // 先把 👀 撤掉，再挂新表情；两步都不做的话，回执会停在「在算」
    await entry.bot.emojiReaction(entry.target, entry.msgId, '👀', true).catch(() => {});
    if (emoji !== '') await entry.bot.emojiReaction(entry.target, entry.msgId, emoji);
  } catch {
    // 回执失败不影响任何主流程
  }
}

/**
 * 收消息回执中间件 —— 用 emoji reaction 表示「收到了 / 处理完了 / 出错了」
 *
 * 推推没有「输入中」状态，但消息可以挂表情回应（emojiReaction）。给用户刚发的那条
 * 消息先挂一个「在算」，处理完换成「好了」，出错换成「不太对」——用户不会以为
 * 机器人卡死了，也不用多发一条消息去刷屏。
 *
 * 挂在门控之后：被拦下/不该回的消息不挂任何表情，免得给人「已读还装死」的错觉。
 */
import type { Logger, Middleware, MiddlewareContext } from '../../types.ts';

export interface ReceiptReactionOptions {
  /** 总开关 */
  enabled?: boolean;
  /** 群聊里也给回执（默认开：群里更需要「我在处理」的反馈） */
  inGroup?: boolean;
  /** 收到时挂的表情（默认 👀；空串 = 不挂） */
  ack?: string;
  /** 处理完换成的表情（默认 ✅；空串 = 只撤不换） */
  done?: string;
  /** 处理出错换成的表情（默认 😵；空串 = 只撤不换） */
  fail?: string;
  /** 只对通过 predicate 的消息回应，默认全部 */
  predicate?: (ctx: MiddlewareContext) => boolean;
  logger?: Logger;
}

/** 兼容旧名：只发一个收消息回执 */
export type TypingIndicatorOptions = ReceiptReactionOptions;

export function receiptReactions(options: ReceiptReactionOptions = {}): Middleware {
  const enabled = options.enabled ?? true;
  const inGroup = options.inGroup ?? true;
  const ack = options.ack ?? '👀';
  const done = options.done ?? '✅';
  const fail = options.fail ?? '😵';
  const predicate = options.predicate;
  const log = options.logger;

  return async (ctx, next) => {
    if (!enabled) {
      await next();
      return;
    }
    const kind = ctx.message.kind;
    const allowed = kind === 'c2c' || (kind === 'group' && inGroup);
    const msgId = ctx.replyTarget.msgId;
    if (!allowed || !msgId || (predicate !== undefined && !predicate(ctx))) {
      await next();
      return;
    }

    const target = ctx.replyTarget;
    const react = (emoji: string, cancel = false): Promise<void> => {
      if (emoji === '') return Promise.resolve();
      return ctx.bot.emojiReaction(target, msgId, emoji, cancel).catch((err: unknown) => {
        // 回执只是锦上添花：权限不足 / 消息已撤回都不该影响正常处理
        log?.debug('[receipt] 表情回应失败: ' + (err instanceof Error ? err.message : String(err)));
      });
    };

    await react(ack);

    try {
      await next();
      await react(ack, true);   // 先撤掉「在算」
      await react(done);        // 再换成「好了」
    } catch (err) {
      await react(ack, true);
      await react(fail);
      throw err;
    }
  };
}

/** 旧名保留（文档 / 第三方引用的入口） */
export const typingIndicator = receiptReactions;

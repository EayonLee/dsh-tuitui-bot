/**
 * 待答问题 / 待批审批截获中间件 — 用户在作答，这条消息不该进模型
 *
 * ask_user_question 挂起时，用户的下一句话是对问题通道的回答（选项序号 / 自由文本）；
 * 审批卡片退化为纯文本时，用户的「1 / 同意 / 2 / 拒绝」同理。两者都必须交给
 * 对应通道解析，而不是又开一轮对话。
 *
 * 位置很关键：**必须排在 concurrencyGuard 之前**。答案消息若被 merge 缓冲排队，
 * 就会出现「turn 等答案 ↔ 答案在队列里等 turn」的死锁 —— 上游为此专门把本中间件
 * 放在并发守卫前面，此处照搬。审批通道同样适用，所以两者共用一个位置。
 *
 * 判定顺序：先问题后审批。两个通道的 answerFromText 都自带「有没有 pending」
 * 的判断，只有内容确实是合法答案时才返回 true，闲聊会原样放行，不会吞消息。
 *
 * 实现决策：不在这里补录 msgid —— 推推没有被动回复的条数限额，补录反而会让
 * 推推没有被动回复限额（引用回复靠 `referenceMessageId`），所以这一步不需要。
 */
import type { Logger, Middleware, MiddlewareContext } from '../../types.ts';

/** 文本应答通道的最小结构（问题通道与审批通道同形） */
export interface QuestionChannelLike {
  /**
   * 把一条消息正文当作答案消费；消费成功返回 true。
   * 返回 false 表示当前没有待答项 / 内容不是有效答案，消息继续走正常链路。
   */
  answerFromText?(ctx: MiddlewareContext): boolean | Promise<boolean>;
}

/**
 * 提供待答通道的宿主（SessionManager 的结构子集）。
 *
 * 注意这里把两个通道都收成 `unknown`：SessionManager 上它们的静态类型是会话回收
 * 用的窄契约（只声明 cancelPending，见 session/types.ts），而运行时拿到的是
 * features/question-channel 与 features/approval-channel 的完整实现。
 * 用 unknown + 收窄可以既不对 session 层提要求，也不让本中间件绑死到 features。
 */
export interface QuestionAnswerHost {
  questionChannel?: unknown;
  approvalChannel?: unknown;
}

export interface QuestionAnswerOptions {
  logger?: Logger;
}

/** 依次尝试两个通道；任一消费即返回其名字 */
async function tryChannels(
  channels: Array<{ name: 'question-answer' | 'approval-answer'; channel: QuestionChannelLike }>,
  ctx: MiddlewareContext,
  logger: Logger | undefined,
): Promise<'question-answer' | 'approval-answer' | null> {
  for (const { name, channel } of channels) {
    if (!channel.answerFromText) continue;
    try {
      if (await channel.answerFromText(ctx)) return name;
    } catch (err) {
      // 解析失败不能让消息卡死：当成「没消费」，继续下一通道 / 正常链路
      logger?.warn(
        `[question-answer] ${name} 解析异常，继续往下走: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return null;
}

export function questionAnswer(
  manager: QuestionAnswerHost,
  options: QuestionAnswerOptions = {},
): Middleware {
  const log = options.logger;

  return async (ctx, next) => {
    const question = manager.questionChannel as QuestionChannelLike | null | undefined;
    const approval = manager.approvalChannel as QuestionChannelLike | null | undefined;

    if (!question?.answerFromText && !approval?.answerFromText) {
      await next();
      return;
    }

    const consumed = await tryChannels(
      [
        { name: 'question-answer', channel: question ?? {} },
        { name: 'approval-answer', channel: approval ?? {} },
      ],
      ctx,
      log,
    );

    if (consumed === 'question-answer') {
      log?.debug('[question-answer] 消息已被待答问题消费');
      ctx.state.answeredQuestion = true;
      ctx.skip('question-answer');
      return;
    }

    if (consumed === 'approval-answer') {
      log?.debug('[question-answer] 消息已被待批审批消费');
      // MiddlewareState 有索引签名，这里额外标注审批来源，便于入站侧排查
      ctx.state.answeredApproval = true;
      ctx.skip('approval-answer');
      return;
    }

    await next();
  };
}

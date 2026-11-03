/**
 * @ 门控中间件 — 决定一条群聊 / 帖子消息该不该回复
 *
 * 群聊与团队频道里绝大多数消息不是对机器人说的，需要 @ 才响应才能避免打扰。
 * 判定结果写进 `ctx.state.mention`，供下游（历史缓冲、入站组装）复用，
 * 这样「不回应但仍记账」才能成立。
 *
 * 推推的原生信号比 QQ 干净得多：事件体直接带 `at_me` 布尔位（群聊与帖子都有），
 * 不需要再扫内容里的 `<@!appId>` 标记，也不存在「同一事件既推全量又推 @ 版」的歧义。
 * 因此判定优先级是：
 *   1. `message.atMe`（推推权威信号）
 *   2. `isImplicitMention`（业务自定义的隐式 @，例如「回复了机器人某条消息」）
 */
import type { Logger, Middleware, MiddlewareContext } from '../../types.ts';

export interface MentionDecision {
  /** 是否被显式 @ */
  wasMentioned: boolean;
  /** 是否命中隐式 @ 规则 */
  implicit: boolean;
  /** 最终是否应该回应 */
  shouldAnswer: boolean;
  /** shouldAnswer=false 时的原因 */
  reason: 'no_mention' | 'other_mention' | 'passthrough';
}

export interface MentionGateOptions {
  /** 群聊是否必须 @，默认 true */
  requireMentionInGroup?: boolean;
  /** 团队帖子是否必须 @，默认 true */
  requireMentionInPost?: boolean;
  /** 单聊一律视为对机器人说，默认 true */
  alwaysAnswerC2C?: boolean;
  /** 隐式 @ 探针（如回复了机器人的消息） */
  isImplicitMention?: (ctx: MiddlewareContext) => boolean;
  /**
   * 跳过「@ 了别人但没 @ 本机器人」的消息，避免抢别人的话。
   * 默认 false：requireMention=false 时用户明确要全量响应，此项不生效。
   */
  ignoreOtherMentions?: boolean;
  /** 只标注 `state.mention` 而不中断链（历史缓冲仍要跑），默认 false */
  passthrough?: boolean;
  /** 跳过时回调（遥测 / 记账） */
  onSkip?: (ctx: MiddlewareContext, decision: MentionDecision) => void;
  /** 动态策略覆盖，优先级高于静态选项 */
  resolveConfig?: (ctx: MiddlewareContext) => {
    requireMentionInGroup?: boolean;
    requireMentionInPost?: boolean;
    ignoreOtherMentions?: boolean;
  };
  logger?: Logger;
}

export function mentionGate(options: MentionGateOptions = {}): Middleware {
  const {
    requireMentionInGroup = true,
    requireMentionInPost = true,
    alwaysAnswerC2C = true,
    isImplicitMention,
    onSkip,
    ignoreOtherMentions = false,
    passthrough = false,
    resolveConfig,
  } = options;
  const log = options.logger;

  /** 跳过（或仅标注）的统一出口，避免两条分支各写一遍 passthrough 逻辑 */
  async function applyDecision(
    ctx: MiddlewareContext,
    decision: MentionDecision,
    next: () => Promise<void>,
  ): Promise<void> {
    // 先写 state 再判定：即使不回应，downstream 的 history/envelope 也要知道是否被 @
    ctx.state.mention = decision;

    if (!decision.shouldAnswer) {
      onSkip?.(ctx, decision);
      log?.debug(
        `[mention-gate] 跳过 ${ctx.message.kind} 消息（${decision.reason}）: `
        + `wasMentioned=${decision.wasMentioned}, implicit=${decision.implicit}`,
      );
      if (!passthrough) {
        ctx.skip('mention');
        return;
      }
    }

    await next();
  }

  return async (ctx, next) => {
    const msg = ctx.message;

    // 单聊：没有「群里人多」的问题，默认永远当作对机器人说
    if (msg.kind === 'c2c') {
      const decision: MentionDecision = {
        wasMentioned: true,
        implicit: false,
        shouldAnswer: alwaysAnswerC2C,
        reason: alwaysAnswerC2C ? 'passthrough' : 'no_mention',
      };
      await applyDecision(ctx, decision, next);
      return;
    }

    const dynamic = resolveConfig?.(ctx);
    const requireMention = msg.kind === 'group'
      ? (dynamic?.requireMentionInGroup ?? requireMentionInGroup)
      : (dynamic?.requireMentionInPost ?? requireMentionInPost);
    const ignoreOthers = dynamic?.ignoreOtherMentions ?? ignoreOtherMentions;

    const wasMentioned = msg.atMe === true;
    const implicit = isImplicitMention?.(ctx) ?? false;

    let shouldAnswer = !requireMention || wasMentioned || implicit;
    let reason: MentionDecision['reason'] = shouldAnswer ? 'passthrough' : 'no_mention';

    // @ 了别人却没 @ 本机器人 → 明确判定为「不是对我说的」。
    // 只在 requireMention 生效时才有意义（否则用户要求全量响应）。
    if (ignoreOthers && requireMention && !wasMentioned && !implicit) {
      const others = msg.at ?? [];
      if (others.length > 0) {
        shouldAnswer = false;
        reason = 'other_mention';
      }
    }

    const decision: MentionDecision = { wasMentioned, implicit, shouldAnswer, reason };
    await applyDecision(ctx, decision, next);
  };
}

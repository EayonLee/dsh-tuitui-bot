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
  /** 实际生效的触发策略（便于日志与测试断言） */
  policy?: 'require' | 'always' | 'smart';
}

export interface MentionGateOptions {
  /** 群聊是否必须 @，默认 true（policy 未给时的兜底推导） */
  requireMentionInGroup?: boolean;
  /** 团队帖子是否必须 @，默认 true */
  requireMentionInPost?: boolean;
  /**
   * 触发策略（优先于上面两个布尔）：
   *   require=仅 @ 才回；always=全部回；smart=不 @ 也回，但只回相关消息
   */
  policy?: 'require' | 'always' | 'smart';
  /** smart 模式的相关性探针（引用机器人 / 命中别名 / 追问窗口） */
  isSmartReply?: (ctx: MiddlewareContext) => boolean;
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
    isSmartReply,
    onSkip,
    ignoreOtherMentions = false,
    passthrough = false,
    resolveConfig,
  } = options;
  const fixedPolicy = options.policy;
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

    // 策略优先级：显式 policy > 布尔开关推导（requireMention=false 等价于 always）
    const policy: 'require' | 'always' | 'smart' = fixedPolicy ?? (requireMention ? 'require' : 'always');

    const wasMentioned = msg.atMe === true;
    const implicit = isImplicitMention?.(ctx) ?? false;
    const smartHit = policy === 'smart' ? (isSmartReply?.(ctx) ?? false) : false;

    let shouldAnswer: boolean;
    if (policy === 'always') shouldAnswer = true;
    else if (policy === 'smart') shouldAnswer = wasMentioned || implicit || smartHit;
    else shouldAnswer = wasMentioned || implicit;
    let reason: MentionDecision['reason'] = shouldAnswer ? 'passthrough' : 'no_mention';

    // @ 了别人却没 @ 本机器人 → 明确判定为「不是对我说的」。
    // 只在 requireMention 生效时才有意义（否则用户要求全量响应）。
    if (ignoreOthers && policy !== 'always' && !wasMentioned && !implicit && !smartHit) {
      const others = msg.at ?? [];
      if (others.length > 0) {
        shouldAnswer = false;
        reason = 'other_mention';
      }
    }

    const decision: MentionDecision = { wasMentioned, implicit, shouldAnswer, reason, policy };
    if (policy === 'smart' && smartHit) {
      log?.debug('[mention-gate] smart 命中：非 @ 但判定为对机器人说的消息');
    }
    await applyDecision(ctx, decision, next);
  };
}

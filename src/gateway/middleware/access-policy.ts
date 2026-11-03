/**
 * 访问控制中间件 — 按单聊 / 群聊 / 团队帖子三套名单做门控
 *
 * 推推没有平台侧的「允许名单」概念，生产部署通常需要自己限定哪些群、哪些人
 * 可以对话。本中间件纯声明式：只依据 `ctx.message` 判定，不通过就 `skip` 掉整条链。
 *
 * 名单匹配的标识符（与配置项语义对应）：
 *   - c2c  → senderAccount 或 senderId（域账号是主键，uid 兜底，两者任一命中即可）
 *   - group → groupId
 *   - post → channelId 或 teamId（同一个名单既能按频道也能按团队放行）
 *
 * ⚠️ allowlist 模式且名单为空时一律拒绝（fail-closed）：配置漏填比误放行安全。
 */
import type { ChatScope, Logger, Middleware, MiddlewareContext } from '../../types.ts';

/** 名单匹配规则：通配 / 精确字符串 / 正则 / 自定义判定 */
export type AccessMatcher = '*' | string | RegExp | ((ctx: MiddlewareContext) => boolean);

/** 单个作用域的访问策略 */
export interface ScopePolicy {
  /** open=全放行；allowlist=仅名单；blocklist=除黑名单外全放行；disabled=全拒绝 */
  mode?: 'open' | 'allowlist' | 'blocklist' | 'disabled';
  /** mode=allowlist 时判定放行的规则 */
  allow?: AccessMatcher[];
  /** 拒绝规则，最先评估 */
  deny?: AccessMatcher[];
}

export interface AccessPolicy {
  c2c?: ScopePolicy;
  group?: ScopePolicy;
  post?: ScopePolicy;
  /** 被拦下时的回调（遥测 / 调试日志） */
  onBlock?: (ctx: MiddlewareContext, reason: string) => void;
  logger?: Logger;
}

function matcherMatches(matcher: AccessMatcher, values: string[], ctx: MiddlewareContext): boolean {
  if (matcher === '*') return true;
  if (typeof matcher === 'string') return values.includes(matcher);
  if (matcher instanceof RegExp) {
    // 逐值匹配；先清 lastIndex，避免 /g 正则跨值残留状态导致漏判
    return values.some((value) => {
      matcher.lastIndex = 0;
      return matcher.test(value);
    });
  }
  if (typeof matcher === 'function') return matcher(ctx);
  return false;
}

interface ScopeDecision {
  allowed: boolean;
  reason: string;
}

/**
 * 评估单个作用域。
 *
 * @param identifiers 该作用域用于比对的全部候选标识（任一命中即算命中）
 */
function evaluateScope(
  policy: ScopePolicy | undefined,
  identifiers: string[],
  ctx: MiddlewareContext,
): ScopeDecision {
  const mode = policy?.mode ?? 'open';
  const label = identifiers.filter((v) => v !== '').join('|') || '(empty)';

  // deny 永远先评估：黑名单优先级高于任何模式
  if (policy?.deny) {
    for (const matcher of policy.deny) {
      if (matcherMatches(matcher, identifiers, ctx)) {
        return { allowed: false, reason: `denied by deny-list (${label})` };
      }
    }
  }

  if (mode === 'disabled') {
    return { allowed: false, reason: 'scope disabled by policy' };
  }
  // blocklist 语义 = 默认放行（黑名单已在最前面判过），这里与 open 同义，
  // 单列分支只为让「用户明确选了黑名单模式」在日志/调试里可辨认。
  if (mode === 'open' || mode === 'blocklist') {
    return { allowed: true, reason: '' };
  }

  // mode === 'allowlist'：名单为空必须 fail-closed，否则部署时漏填名单=全放行
  if (!policy?.allow || policy.allow.length === 0) {
    return { allowed: false, reason: 'allowlist is empty' };
  }
  for (const matcher of policy.allow) {
    if (matcherMatches(matcher, identifiers, ctx)) {
      return { allowed: true, reason: '' };
    }
  }
  return { allowed: false, reason: `not in allowlist (${label})` };
}

/** 取某个消息在对应作用域下参与名单比对的标识 */
function identifiersFor(scope: ChatScope, ctx: MiddlewareContext): string[] {
  const msg = ctx.message;
  if (scope === 'c2c') {
    // 域账号是主键；有些租户下 uid 才是稳定值，两个都给 matcher 试一次
    return [msg.senderAccount, msg.senderId].filter((v): v is string => typeof v === 'string' && v !== '');
  }
  if (scope === 'group') {
    return [msg.groupId ?? ''];
  }
  return [msg.post?.channelId ?? '', msg.post?.teamId ?? ''].filter((v) => v !== '');
}

export function accessPolicy(policy: AccessPolicy = {}): Middleware {
  const log = policy.logger;
  return async (ctx, next) => {
    const { kind, senderAccount, senderId } = ctx.message;

    let decision: ScopeDecision;
    if (kind === 'c2c') {
      decision = evaluateScope(policy.c2c, identifiersFor('c2c', ctx), ctx);
    } else if (kind === 'group') {
      decision = evaluateScope(policy.group, identifiersFor('group', ctx), ctx);
    } else if (kind === 'post') {
      decision = evaluateScope(policy.post, identifiersFor('post', ctx), ctx);
    } else {
      // 未知作用域不拦：宁可让下游按自身规则处理，也不要静默吞掉新事件类型
      decision = { allowed: true, reason: '' };
    }

    if (!decision.allowed) {
      log?.debug(`[access] 拦下 ${kind} 消息（sender=${senderAccount || senderId}）: ${decision.reason}`);
      policy.onBlock?.(ctx, decision.reason);
      ctx.skip('access');
      return;
    }

    await next();
  };
}

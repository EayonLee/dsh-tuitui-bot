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
import type { Logger, Middleware, MiddlewareContext } from '../../types.ts';
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
export declare function accessPolicy(policy?: AccessPolicy): Middleware;
//# sourceMappingURL=access-policy.d.ts.map
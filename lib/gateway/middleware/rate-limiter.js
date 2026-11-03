/**
 * 默认三层限额。
 *
 * 上游在配置缺省时等价于「不限流」（SDK 的 rateLimiter() 不传 tier 就是空转），
 * 这里给出一组保守默认值：机器人被@刷屏时最容易崩的是会话锁与模型额度，
 * 而正常人类对话远远到不了这些数。需要完全不限流时显式传 false。
 */
export const DEFAULT_RATE_LIMITS = {
    // 阈值刻意定得远高于人类打字速度：这道闸防的是机器人自激循环 / 刷接口，
    // 不是限制正常用户连发几条消息。
    perSender: { max: 30, windowMs: 60_000 },
    perGroup: { max: 120, windowMs: 60_000 },
    global: { max: 600, windowMs: 60_000 },
};
/** 滑动窗口计数器：只保留窗口内的时间戳 */
class SlidingWindow {
    buckets = new Map();
    max;
    windowMs;
    now;
    constructor(tier, now) {
        this.max = tier.max;
        this.windowMs = tier.windowMs;
        this.now = now;
    }
    /** 允许则记一次并返回 true；超限返回 false（不记次） */
    check(key) {
        const now = this.now();
        let hits = this.buckets.get(key);
        if (!hits) {
            hits = [];
            this.buckets.set(key, hits);
        }
        // 淘汰窗口外的记录；数组按时间递增，撞到第一条未过期的即可收工
        while (hits.length > 0 && now - hits[0] > this.windowMs) {
            hits.shift();
        }
        if (hits.length >= this.max)
            return false;
        hits.push(now);
        return true;
    }
}
/** 取某个作用域下的限流键：群按群、帖子按频道、单聊退化为发送者 */
function groupKeyOf(ctx) {
    const msg = ctx.message;
    if (msg.kind === 'group')
        return `group:${msg.groupId ?? msg.senderId}`;
    if (msg.kind === 'post') {
        return `post:${msg.post?.teamId ?? ''}/${msg.post?.channelId ?? msg.senderId}`;
    }
    return `c2c:${msg.senderId}`;
}
export function rateLimiter(options = {}) {
    const now = options.now ?? (() => Date.now());
    const log = options.logger;
    const pick = (value, fallback) => {
        if (value === false)
            return null;
        return value ?? fallback;
    };
    const perSenderTier = pick(options.perSender, DEFAULT_RATE_LIMITS.perSender);
    const perGroupTier = pick(options.perGroup, DEFAULT_RATE_LIMITS.perGroup);
    const globalTier = pick(options.global, DEFAULT_RATE_LIMITS.global);
    const perSender = perSenderTier ? new SlidingWindow(perSenderTier, now) : null;
    const perGroup = perGroupTier ? new SlidingWindow(perGroupTier, now) : null;
    const global = globalTier ? new SlidingWindow(globalTier, now) : null;
    /** 超限统一出口：先回调再 skip，让 onLimit 能发出提示 */
    async function reject(ctx, tier) {
        log?.debug(`[rate-limiter] ${tier} 超限，丢弃消息（sender=${ctx.message.senderId}）`);
        await options.onLimit?.(ctx, tier);
        ctx.skip('rate');
    }
    return async (ctx, next) => {
        const senderId = ctx.message.senderId;
        // 从最省事的一层开始短路：全局超限时后面两层连查都不用查
        if (global && !global.check('__global__')) {
            await reject(ctx, 'global');
            return;
        }
        if (perGroup && !perGroup.check(groupKeyOf(ctx))) {
            await reject(ctx, 'perGroup');
            return;
        }
        if (perSender && !perSender.check(senderId)) {
            await reject(ctx, 'perSender');
            return;
        }
        await next();
    };
}
//# sourceMappingURL=rate-limiter.js.map
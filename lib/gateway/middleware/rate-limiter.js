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
/** 滑动窗口计数器：只保留窗口内的时间戳（导出仅为单测直接验证桶回收） */
export class SlidingWindow {
    buckets = new Map();
    max;
    windowMs;
    now;
    /**
     * 键数量上限：超过就全表扫一遍，清掉已经过期的空桶。
     *
     * 键是 senderId / groupId / post 频道，正常量级受组织规模约束；但如果某天遇到
     * 大量一次性群或爬虫式 sender，光靠「下次 check 时顺手清」是清不掉的——
     * 那些键再也不来，空桶就永久占着内存（#48）。
     */
    maxKeys;
    constructor(tier, now, maxKeys = 4096) {
        this.max = tier.max;
        this.windowMs = tier.windowMs;
        this.now = now;
        this.maxKeys = maxKeys;
    }
    /** 当前占用中的键数量（单测断言桶回收用） */
    get size() {
        return this.buckets.size;
    }
    /** 允许则记一次并返回 true；超限返回 false（不记次） */
    check(key) {
        const now = this.now();
        if (this.buckets.size > this.maxKeys)
            this.sweep(now);
        const hits = this.prune(key, now);
        if (hits.length >= this.max)
            return false;
        hits.push(now);
        this.buckets.set(key, hits);
        return true;
    }
    /**
     * 取该键窗口内的命中记录，并顺手删掉空桶。
     *
     * 返回的数组可能是原来那个（同一次 check 里追加后重新 set 回去），
     * 但空桶会立刻从 Map 里删除——「发完就不再来」的键不再永久留一个空数组（#48）。
     */
    prune(key, now) {
        const hits = this.buckets.get(key);
        if (hits === undefined)
            return [];
        // 数组按时间递增，撞到第一条未过期的即可收工
        while (hits.length > 0 && now - hits[0] > this.windowMs) {
            hits.shift();
        }
        if (hits.length === 0)
            this.buckets.delete(key);
        return hits;
    }
    /** 全表清理：删掉已经完全没有命中的桶（键数超上限时才跑） */
    sweep(now) {
        for (const key of [...this.buckets.keys()])
            this.prune(key, now);
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
/**
 * 限流中间件 — 三层滑动窗口：发送者 / 群（或帖子频道）/ 全局
 *
 * 推推平台侧没有被动回复的条数限额，但机器人被刷屏时消耗的是模型额度与
 * 会话锁，所以仍需要一道自保闸门。
 *
 * 算法照搬上游的滑动窗口计数器（不是经典令牌桶，而是「窗口内计数」）：
 * 每次检查顺手淘汰过期时间戳即可，窗口一过自然恢复，不需要后台定时器 ——
 * 定时器会让进程无法自然退出，也容易在长连接重连后堆积。
 * `now` 可注入，单测里用可控时钟即可覆盖「窗口恢复」。
 */
import type { Logger, Middleware, MiddlewareContext } from '../../types.ts';
export interface RateLimitTier {
    /** 窗口内最多允许的消息数 */
    max: number;
    /** 窗口长度(ms) */
    windowMs: number;
}
export interface RateLimiterOptions {
    /** 单发送者限额；传 false 关闭该层 */
    perSender?: RateLimitTier | false;
    /** 单群/单频道限额；传 false 关闭该层 */
    perGroup?: RateLimitTier | false;
    /** 全局限额；传 false 关闭该层 */
    global?: RateLimitTier | false;
    /** 注入时钟（单测用），默认 Date.now */
    now?: () => number;
    /** 被限流时的回调（回一句「慢一点」/ 打点） */
    onLimit?: (ctx: MiddlewareContext, tier: RateLimitTierName) => void | Promise<void>;
    logger?: Logger;
}
export type RateLimitTierName = 'perSender' | 'perGroup' | 'global';
/**
 * 默认三层限额。
 *
 * 上游在配置缺省时等价于「不限流」（SDK 的 rateLimiter() 不传 tier 就是空转），
 * 这里给出一组保守默认值：机器人被@刷屏时最容易崩的是会话锁与模型额度，
 * 而正常人类对话远远到不了这些数。需要完全不限流时显式传 false。
 */
export declare const DEFAULT_RATE_LIMITS: {
    readonly perSender: {
        readonly max: 30;
        readonly windowMs: 60000;
    };
    readonly perGroup: {
        readonly max: 120;
        readonly windowMs: 60000;
    };
    readonly global: {
        readonly max: 600;
        readonly windowMs: 60000;
    };
};
/** 滑动窗口计数器：只保留窗口内的时间戳（导出仅为单测直接验证桶回收） */
export declare class SlidingWindow {
    private readonly buckets;
    private readonly max;
    private readonly windowMs;
    private readonly now;
    /**
     * 键数量上限：超过就全表扫一遍，清掉已经过期的空桶。
     *
     * 键是 senderId / groupId / post 频道，正常量级受组织规模约束；但如果某天遇到
     * 大量一次性群或爬虫式 sender，光靠「下次 check 时顺手清」是清不掉的——
     * 那些键再也不来，空桶就永久占着内存（#48）。
     */
    private readonly maxKeys;
    constructor(tier: RateLimitTier, now: () => number, maxKeys?: number);
    /** 当前占用中的键数量（单测断言桶回收用） */
    get size(): number;
    /** 允许则记一次并返回 true；超限返回 false（不记次） */
    check(key: string): boolean;
    /**
     * 取该键窗口内的命中记录，并顺手删掉空桶。
     *
     * 返回的数组可能是原来那个（同一次 check 里追加后重新 set 回去），
     * 但空桶会立刻从 Map 里删除——「发完就不再来」的键不再永久留一个空数组（#48）。
     */
    private prune;
    /** 全表清理：删掉已经完全没有命中的桶（键数超上限时才跑） */
    private sweep;
}
export declare function rateLimiter(options?: RateLimiterOptions): Middleware;
//# sourceMappingURL=rate-limiter.d.ts.map
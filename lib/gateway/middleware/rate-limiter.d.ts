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
export declare function rateLimiter(options?: RateLimiterOptions): Middleware;
//# sourceMappingURL=rate-limiter.d.ts.map
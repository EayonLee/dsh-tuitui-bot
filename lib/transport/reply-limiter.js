/**
 * 出站节流守卫 — **语义改造，与上游不同**
 *
 * 上游 QQ Bot 的 ReplyLimiter 管理"被动回复限额"：同一条入站消息最多被动回复
 * 4 次、群聊 5 分钟后失效，超限必须降级为主动消息。推推没有这套被动回复模型
 * （referenceMessageId 只影响展示，不消耗额度），整块限额语义在这里失效。
 *
 * 但推推有自己的"不能刷屏"约束：流式被关闭或降级后，切分出的多个 chunk、
 * 工具结果、错误提示、交付物清单会在几百毫秒内连续发出七八条消息，客户端会
 * 把它们挤成一片并触发服务端频控。因此保留文件名与导出名，把语义换成出站
 * 节流守卫：
 *   1. 同一 target 的最小发送间隔（默认 300ms），保证消息按序、可读地下发；
 *   2. 相同内容的短时间去重（默认 2s），挡掉"重试 / 事件重放导致重复发送同一段"；
 *   3. 超限**排队而非丢弃**——这是与上游最关键的区别：上游额度耗尽只能降级
 *      通道（换一种发法），而节流等待只是延迟，把内容吞掉才是越权。
 */
const DEFAULT_MIN_INTERVAL_MS = 300;
const DEFAULT_DEDUPE_WINDOW_MS = 2000;
const DEFAULT_MAX_TRACKED_TARGETS = 1000;
/** 可清除的等待（与 setTimeout 等价，单独包一层只为可读性） */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export class ReplyLimiter {
    minIntervalMs;
    dedupeWindowMs;
    maxTracked;
    targets = new Map();
    constructor(config) {
        this.minIntervalMs = Math.max(0, config?.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
        this.dedupeWindowMs = Math.max(0, config?.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS);
        this.maxTracked = Math.max(1, config?.maxTrackedTargets ?? DEFAULT_MAX_TRACKED_TARGETS);
    }
    /**
     * 纯查询：这次发送会被去重吗？需要等多久？
     *
     * 不改变任何状态——排队中的任务在真正执行前会重新查一次（见 run），
     * 因为排队期间同一 target 可能已经发出过相同内容。
     */
    check(targetKey, content) {
        const state = this.targets.get(targetKey);
        if (state === undefined)
            return { allowed: true, waitMs: 0 };
        const now = Date.now();
        if (state.lastContent === content && now - state.lastContentAt < this.dedupeWindowMs) {
            return { allowed: false, reason: 'deduped', waitMs: 0 };
        }
        const elapsed = now - state.lastSentAt;
        if (elapsed < this.minIntervalMs) {
            return { allowed: true, reason: 'throttled', waitMs: this.minIntervalMs - elapsed };
        }
        return { allowed: true, waitMs: 0 };
    }
    /** 记录一次真正落地的发送（外部直接发消息时也可手动记账） */
    record(targetKey, content) {
        const now = Date.now();
        const state = this.targetState(targetKey);
        state.lastSentAt = now;
        if (content !== undefined) {
            state.lastContent = content;
            state.lastContentAt = now;
        }
    }
    /**
     * 排队发送：同 target 串行、按最小间隔节流、同内容短时间去重。
     *
     * 去重命中时返回 undefined（调用方据此知道"这次没发"，但不算失败）；
     * task 自身抛出的异常原样向上传递，交由调用方记录日志——发送失败不该让
     * 后续排队的消息全部沉默。
     */
    run(targetKey, content, task) {
        const state = this.targetState(targetKey);
        const result = state.chain.then(async () => {
            const decision = this.check(targetKey, content);
            if (!decision.allowed)
                return undefined;
            if (decision.waitMs > 0)
                await delay(decision.waitMs);
            const value = await task();
            this.record(targetKey, content);
            return value;
        });
        // 链上只保留"已完成"信号：任何一次失败都不能毒化后续排队
        state.chain = result.then(() => undefined, () => undefined);
        return result;
    }
    /** 取（或建）target 状态，超出上限时驱逐最早登记的那个 */
    targetState(targetKey) {
        const existing = this.targets.get(targetKey);
        if (existing !== undefined)
            return existing;
        if (this.targets.size >= this.maxTracked) {
            const oldest = this.targets.keys().next().value;
            if (oldest !== undefined)
                this.targets.delete(oldest);
        }
        const created = {
            chain: Promise.resolve(),
            lastSentAt: 0,
            lastContent: '',
            lastContentAt: 0,
        };
        this.targets.set(targetKey, created);
        return created;
    }
}
//# sourceMappingURL=reply-limiter.js.map
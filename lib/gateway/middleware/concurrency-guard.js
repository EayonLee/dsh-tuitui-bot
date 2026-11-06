export function concurrencyGuard(options = {}) {
    const defaultStrategy = options.strategy ?? 'queue';
    const maxQueue = options.maxQueue ?? 3;
    const maxProcessingMs = options.maxProcessingMs ?? 0;
    const log = options.logger;
    const locks = new Map();
    function getState(key) {
        let state = locks.get(key);
        if (!state) {
            state = { busy: false, queue: [] };
            locks.set(key, state);
        }
        return state;
    }
    /** 目标彻底空闲时删掉状态，避免攻击者用大量不同的 targetId 撑爆 Map */
    function cleanupState(key) {
        const state = locks.get(key);
        if (state
            && !state.busy
            && state.queue.length === 0
            && (!state.mergeBuffer || state.mergeBuffer.length === 0)) {
            locks.delete(key);
        }
    }
    function targetKey(ctx) {
        return `${ctx.replyTarget.scope}:${ctx.replyTarget.targetId}`;
    }
    /** 中断一条正在处理的消息：先停链（skip），再交给集成方真正取消 */
    async function interrupt(ctx, reason) {
        ctx.skip(reason);
        try {
            await options.onInterrupt?.(ctx, reason);
        }
        catch (err) {
            log?.error(`[concurrency] onInterrupt 失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /**
     * 排空 merge 缓冲：合并成一条幸存 ctx，标给等待者，再由幸存者自己 next()。
     */
    async function drainMergeBuffer(key, state, ownerCtx) {
        while (state.mergeBuffer && state.mergeBuffer.length > 0) {
            const buffered = state.mergeBuffer.splice(0);
            const waiters = state.mergeWaiters?.splice(0) ?? [];
            const survivor = options.onMerge ? options.onMerge(buffered) : defaultMerge(buffered);
            const first = buffered[0];
            const validSurvivor = buffered.includes(survivor) ? survivor : first;
            log?.debug(`[concurrency:merge] 合并批次: ${key}（count=${buffered.length}）`);
            if (options.onDispatch) {
                // 上游遗留路径：由回调直接派发，所有等待者都不是幸存者
                state.activeCtx = validSurvivor;
                try {
                    await options.onDispatch(validSurvivor);
                }
                catch (err) {
                    log?.error(`[concurrency:merge] onDispatch 失败: ${err instanceof Error ? err.message : String(err)}`);
                }
                finally {
                    state.activeCtx = undefined;
                }
                for (const waiter of waiters)
                    waiter.resolve();
            }
            else {
                for (const waiter of waiters) {
                    if (waiter.ctx === validSurvivor)
                        waiter.markSurvivor();
                    waiter.resolve();
                }
            }
        }
        state.mergeBuffer = undefined;
        state.mergeWaiters = undefined;
        void ownerCtx;
    }
    function drainQueue(key) {
        const state = locks.get(key);
        if (!state)
            return;
        const entry = state.queue.shift();
        if (entry) {
            entry.run();
        }
        else if (!state.busy) {
            locks.delete(key);
        }
    }
    /** abort 策略用：把自己排在队首，等当前这条释放 */
    function waitForRelease(state, ctx) {
        if (!state.busy)
            return Promise.resolve();
        return new Promise((resolve) => {
            state.queue.unshift({ run: resolve, ctx });
        });
    }
    const guard = async (ctx, next) => {
        const key = targetKey(ctx);
        const state = getState(key);
        // 策略可以按消息挑：群里排队、私聊直接打断——同一个 peer 的策略是稳定的
        const strategy = options.strategyFor?.(ctx) ?? defaultStrategy;
        // ── 空闲：自己就是 owner，直接跑 ──
        if (!state.busy) {
            state.busy = true;
            state.activeCtx = ctx;
            if (strategy === 'merge') {
                state.mergeBuffer = [];
                state.mergeWaiters = [];
            }
            let timedOut = false;
            let timeoutId;
            if (maxProcessingMs > 0) {
                timeoutId = setTimeout(() => {
                    timedOut = true;
                    log?.warn(`[concurrency] ${key} 超过 ${maxProcessingMs}ms，中断当前处理`);
                    // 先释放锁再排空队列：否则下一条消息把自己置 busy=true 会被这里的
                    // 释放动作覆盖掉（上游踩过的坑，注释照搬）
                    state.busy = false;
                    state.activeCtx = undefined;
                    void interrupt(ctx, 'concurrency:timeout');
                    if (strategy === 'merge') {
                        drainMergeBuffer(key, state, ctx).catch(() => {
                            // 超时路径上的合并失败无需再上报：原始错误已经由 kernel 收敛
                        });
                    }
                    else {
                        drainQueue(key);
                    }
                    cleanupState(key);
                }, maxProcessingMs);
            }
            try {
                await next();
            }
            finally {
                if (timeoutId)
                    clearTimeout(timeoutId);
                if (!timedOut) {
                    state.activeCtx = undefined;
                    if (strategy === 'merge') {
                        await drainMergeBuffer(key, state, ctx);
                        state.busy = false;
                    }
                    else {
                        state.busy = false;
                        if (strategy === 'queue' || strategy === 'abort') {
                            drainQueue(key);
                        }
                    }
                    cleanupState(key);
                }
            }
            return;
        }
        // ── 忙：按策略处理 ──
        switch (strategy) {
            case 'merge': {
                if (!state.mergeBuffer || !state.mergeWaiters) {
                    state.mergeBuffer = [];
                    state.mergeWaiters = [];
                }
                const mergeBuffer = state.mergeBuffer;
                const mergeWaiters = state.mergeWaiters;
                // 紧急消息（如 /stop）：把已缓冲的都放掉，自己立刻并行跑完剩余链
                if (options.urgentPredicate?.(ctx)) {
                    log?.debug(`[concurrency:merge] 紧急消息插队: ${key}`);
                    // 缓冲内容已被丢弃（没有合并进任何人）→ 通知等待者自己跑完链，不能 skip
                    for (const waiter of mergeWaiters) {
                        waiter.markReleased();
                        waiter.resolve();
                    }
                    mergeBuffer.length = 0;
                    mergeWaiters.length = 0;
                    await next();
                    return;
                }
                if (mergeBuffer.length >= maxQueue) {
                    log?.debug(`[concurrency:merge] 缓冲已满（${maxQueue}），丢弃: ${key}`);
                    await options.onDrop?.(ctx);
                    ctx.skip('concurrency:merge-full');
                    return;
                }
                log?.debug(`[concurrency:merge] 缓冲消息: ${key}（msgId=${ctx.message.messageId} `
                    + `pos=${mergeBuffer.length + 1}）`);
                // 挂起但不 stop：等批次被处理。幸存者继续 next()，其余返回即停链。
                mergeBuffer.push(ctx);
                let isSurvivor = false;
                let wasReleased = false;
                await new Promise((resolve) => {
                    mergeWaiters.push({
                        ctx,
                        resolve,
                        markSurvivor: () => {
                            isSurvivor = true;
                        },
                        markReleased: () => {
                            wasReleased = true;
                        },
                    });
                });
                if (isSurvivor) {
                    await next();
                }
                else if (wasReleased) {
                    // 紧急插队释放的缓冲消息：正文没并入任何人，保持原行为——
                    // 本链到此为止、由集成方单独处理，既不 skip 也不在这里跑下游
                }
                else {
                    // 正文已经并入幸存者：这条必须明确退出链，否则 bootstrap 会把它
                    // 当成「走完链的消息」再单独处理一遍（#35：同一条消息回复两遍）
                    ctx.skip('concurrency:merged');
                }
                return;
            }
            case 'drop': {
                log?.debug(`[concurrency] 目标忙，丢弃消息: ${key}`);
                await options.onDrop?.(ctx);
                ctx.skip('concurrency:drop');
                return;
            }
            case 'abort': {
                log?.debug(`[concurrency] 中断前一条，处理新消息: ${key}`);
                if (state.activeCtx) {
                    await interrupt(state.activeCtx, 'concurrency:abort');
                }
                // 队列里等着的一律作废并放行，让它们各自继续/结束，避免悬挂
                const pending = state.queue.splice(0);
                for (const entry of pending) {
                    if (entry.ctx)
                        entry.ctx.skip('concurrency:superseded');
                    entry.run();
                }
                await waitForRelease(state, ctx);
                if (ctx.skipped !== undefined) {
                    log?.debug(`[concurrency] 等待期间被取代，放弃处理: ${key}`);
                    return;
                }
                state.busy = true;
                state.activeCtx = ctx;
                try {
                    await next();
                }
                finally {
                    state.busy = false;
                    state.activeCtx = undefined;
                    drainQueue(key);
                }
                return;
            }
            case 'queue':
            default: {
                if (state.queue.length >= maxQueue) {
                    // 用 warn：被丢掉的消息是"机器人没回"的真凶之一，debug 级在文件日志里看不见
                    log?.warn(`[concurrency] 队列已满（${maxQueue}），丢弃: ${key}`);
                    await options.onDrop?.(ctx);
                    ctx.skip('concurrency:queue-full');
                    return;
                }
                log?.debug(`[concurrency] 排队: ${key}（pos=${state.queue.length + 1}）`);
                await new Promise((resolve) => {
                    state.queue.push({ run: resolve, ctx });
                });
                state.busy = true;
                state.activeCtx = ctx;
                try {
                    await next();
                }
                finally {
                    state.busy = false;
                    state.activeCtx = undefined;
                    drainQueue(key);
                }
                return;
            }
        }
    };
    return guard;
}
/**
 * 默认合并：保留第一条，把后续正文按行拼接，envelope 与附件一并汇聚。
 * 这样「连发三句话」在模型眼里等价于一段话，而不是三轮互相打断的对话。
 */
function defaultMerge(buffered) {
    const first = buffered[0];
    if (!first)
        throw new Error('concurrency-guard: 空批次无法合并');
    if (buffered.length === 1)
        return first;
    const withContent = buffered.filter((ctx) => (ctx.message.content ?? '') !== '');
    const contents = withContent.map((ctx) => ctx.message.content);
    if (contents.length > 0) {
        first.message.content = contents.join('\n');
    }
    const envelopes = withContent
        .map((ctx) => ctx.state.envelope)
        .filter((value) => typeof value === 'string' && value !== '');
    if (envelopes.length > 0) {
        first.state.envelope = envelopes.join('\n\n');
    }
    const attachments = withContent.flatMap((ctx) => ctx.message.attachments ?? []);
    if (attachments.length > 0) {
        first.message.attachments = attachments;
    }
    return first;
}
//# sourceMappingURL=concurrency-guard.js.map
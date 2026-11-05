/** 安全读宿主服务（cordis 访问守卫要求经 inject 声明，读不到就返回 undefined） */
function readService(ctx, name) {
    try {
        const target = ctx;
        return typeof target.get === 'function' ? target.get(name) : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * 探测并包装宿主热重载。
 *
 * @param ctx - cordis 插件上下文
 * @param entryIds - 要重建的入口 id（本插件是 `im-tuitui`）
 * @param logger - 日志
 */
export function createHotReload(ctx, entryIds, logger) {
    const service = readService(ctx, 'hmr');
    const usable = service !== undefined
        && typeof service.runExclusive === 'function'
        && typeof service.reconcileProfile === 'function';
    return {
        available: usable,
        schedule() {
            if (!usable)
                return false;
            // 延后：响应必须先把字节发出去，否则 reconcile 会把这条连接的 fiber 一起收走
            setTimeout(() => {
                void (async () => {
                    try {
                        logger.info('im-tuitui: 开始热重载（无需重启进程）');
                        await service.runExclusive(() => service.reconcileProfile(entryIds));
                        logger.info('im-tuitui: 热重载完成');
                    }
                    catch (err) {
                        logger.error('im-tuitui: 热重载失败，需手动重启: ' + (err instanceof Error ? err.message : String(err)));
                    }
                })();
            }, 300);
            return true;
        },
    };
}
//# sourceMappingURL=hot-reload.js.map
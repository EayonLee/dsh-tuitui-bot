/**
 * 宿主的插件热重载通道（@deepseek-ai/dsh-hmr）
 *
 * dsh 自带 HMR 服务：`hmr.reconcileProfile(ids)` 会按 manifest 与 patch 重新组合
 * profile，把磁盘上文件已经变化的、正在运行的插件**就地替换**（evict 旧模块 →
 * 停旧 fiber → 用新代码重新 import 并启动）。这就是「装完不用重启」的官方通道。
 *
 * 三个必须守住的点：
 *   1. 探测用 `ctx.get`（cordis 对未注入的服务直接抛错），拿不到就当没有，
 *      不能因此把整个插件启动搞挂；
 *   2. reconcile 必须跑在 `hmr.runExclusive` 里（官方要求，和自动重载互斥）；
 *   3. reconcile 会把**当前正在执行这次调用的 fiber** 一起 dispose —— 所以调用方
 *      必须先把 HTTP 响应发出去，再用定时器延后触发。
 */
import type { Logger } from '../types.ts';
/** 热重载能力 */
export interface HotReload {
    /** 宿主是否提供 HMR 服务 */
    available: boolean;
    /**
     * 触发一次热重载（内部已延后，可安全地在发完响应后调用）。
     * 返回 false 表示宿主没有这个能力。
     */
    schedule(): boolean;
}
/**
 * 探测并包装宿主热重载。
 *
 * @param ctx - cordis 插件上下文
 * @param entryIds - 要重建的入口 id（本插件是 `im-tuitui`）
 * @param logger - 日志
 */
export declare function createHotReload(ctx: unknown, entryIds: readonly string[], logger: Logger): HotReload;
//# sourceMappingURL=hot-reload.d.ts.map
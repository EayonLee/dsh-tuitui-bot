/**
 * 启动时的一次版本提示：查到一个更新的版本就 info 一行，查不到就静默。
 *
 * 为什么放在启动而不是只留给设置页：大部分人开完机器人就不再打开设置页，
 * 「有新版可升」这件事只能靠日志被动发现。这里**只打日志、不自动更新**，
 * 也不阻塞启动（调用方 fire-and-forget）。
 *
 * 网络失败、API 限流、atom 也挂了 —— 一律静默：更新提示失败不该影响渠道本身。
 */
import { REPO_SLUG } from "../shared/about-protocol.js";
import { readInstalledPackage } from "./self-update.js";
import { checkLatest, isNewer } from "./version-check.js";
/** 与设置页同一个 fetch 收窄口径 */
const defaultFetch = async (url, init) => await fetch(url, init);
/**
 * 查一次新版本并（有更新时）打一行 info。
 *
 * 返回结构化结果方便单测断言；内部已经吞掉所有异常，不会 reject。
 */
export async function notifyUpdateOnStartup(options) {
    const { logger, channel } = options;
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    const readVersion = options.readVersion
        ?? (async () => (await readInstalledPackage()).version);
    try {
        const current = await readVersion();
        const lookup = await checkLatest({ slug: REPO_SLUG, channel, fetchImpl });
        const latest = lookup.latest;
        if (latest === null) {
            // 查不到（限流 / 断网）：没有可比对的东西，静默收工
            logger.debug(`im-tuitui: 版本检查没拿到结果（当前 ${current}）`);
            return null;
        }
        if (!isNewer(latest, current)) {
            logger.debug(`im-tuitui: 版本检查完成（当前 ${current}，最新 ${latest}）`);
            return { current, latest, message: null };
        }
        const message = `im-tuitui: 有新版本 ${latest}（当前 ${current}）——升级用 `
            + `dsh plugin --profile <name> add @eayonlee/dsh-tuitui-bot@latest，装完重启`;
        logger.info(message);
        return { current, latest, message };
    }
    catch (err) {
        // 任何异常都只是「没提示成」，不影响渠道启动
        logger.debug(`im-tuitui: 启动版本检查失败: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}
//# sourceMappingURL=startup-version.js.map
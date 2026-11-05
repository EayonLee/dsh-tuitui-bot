import { ABOUT_PATH, UPDATE_APPLY_PATH, UPDATE_CHECK_PATH } from '../shared/about-protocol.ts';
import type { ImTuituiConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import { type FetchLike } from './version-check.ts';
import { type InstalledPackage } from './self-update.ts';
import type { HotReload } from './hot-reload.ts';
import type { WebServerLike } from './bind-routes.ts';
export { ABOUT_PATH, UPDATE_APPLY_PATH, UPDATE_CHECK_PATH };
/** 路由注入 */
export interface AboutRoutesOptions {
    /** 当前生效配置（读 selfUpdate.enabled / channel） */
    config: () => ImTuituiConfig;
    logger: Logger;
    /** 热重载通道 */
    hotReload: HotReload;
    /** 已安装包信息（默认读包内 package.json；单测注入） */
    readInstalled?: () => Promise<InstalledPackage>;
    /** 网络（默认全局 fetch；单测注入） */
    fetchImpl?: FetchLike;
    /** profile 目录（默认从 shared 取；单测注入） */
    profileDir?: () => string | null;
    /** pnpm 可执行文件（默认 PATH 里的 pnpm） */
    pnpmCommand?: string;
}
/**
 * 注册「关于 / 检查更新 / 一键更新」三条路由。
 *
 * @returns 注销函数（与插件 fiber 生命周期绑定）
 */
export declare function registerAboutRoutes(webServer: WebServerLike, options: AboutRoutesOptions): () => void;
//# sourceMappingURL=about-routes.d.ts.map
/**
 * 凭据绑定编排 — setup/ 模块入口
 *
 * apply() 检测到凭据缺失时调用 ensureCredentials：
 * 1. 创建 BindingService（单例接管，HMR 双 fiber 安全）
 * 2. Web 宿主（dsh web / Desktop）注册端内绑定页路由
 *    —— 经 ctx.inject(['webServer'], ...) 可选注入：服务未就绪时插件
 *       照常加载（CLI profile），就绪/替换时自动（再）注册路由
 * 3. 按宿主形态挂呈现策略（终端打印绑定向导；Desktop 无可见终端，由端内页面承载）
 * 4. 生命周期与 ctx fiber 绑定（dispose 时终止状态机、注销路由）
 *
 * 凭据已配置的 fiber 调用 registerBoundCredentialRoutes 注册常驻路由
 * （bound 状态回显 + 手动编辑/更换 + 配置编辑），与绑定流程共用持久化路径。
 *
 * 与上游差异：推推无扫码，ensureCredentials 不再有「等待扫码结果」的挂起
 * Promise——向导打印完即 resolve null，凭据由用户手填后经 persist 落盘。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ImTuituiConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { SetupCredentials } from './persist.ts';
export type { SetupCredentials } from './persist.ts';
export { persistCredentialsToProfile } from './persist.ts';
export { isDesktopHost } from './presenters.ts';
/** ensureCredentials 参数 */
export interface EnsureCredentialsOptions {
    logger: Logger;
    /** 当前生效配置（apply 时 loader 合并值；端点覆盖与 config 路由 GET 回显共用） */
    config: ImTuituiConfig;
}
/**
 * 执行绑定编排，返回凭据就绪的 Promise；推推没有可等待的扫码任务，
 * 因此总是 resolve null（凭据由端内页面手填并写入 profile 后经 HMR 生效）。
 *
 * 【同步契约】函数体必须保持无 await——绑定编排（服务接管、路由注册、
 * 呈现策略、ctx 生命周期挂载）在调用后的同步阶段全部完成，随后返回
 * `service.start()` 的已 resolve Promise。调用方（插件 apply）因此可以
 * 不等待绑定结果直接完成加载：boot 的 `loader.await()` 会等所有插件 fiber
 * settle，若 apply 无限期等待用户手填，Host ready 会被阻塞
 * （Desktop 界面无法进入、Web URL 延迟输出）。
 */
export declare function ensureCredentials(ctx: Context, options: EnsureCredentialsOptions): Promise<SetupCredentials | null>;
/**
 * 凭据已配置的 fiber 注册常驻路由（状态回显 + 手动编辑/更换 + 配置编辑）。
 *
 * 在 apply 的 bootstrapGateway 之前调用；写入经同一 persist 路径，
 * 保存后触发 HMR 重载、新 fiber 以新凭据重启网关。
 */
export declare function registerBoundCredentialRoutes(ctx: Context, logger: Logger, appId: string, config: ImTuituiConfig): void;
//# sourceMappingURL=index.d.ts.map
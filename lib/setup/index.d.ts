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
/** 本插件在 profile 组合树里的入口 id（热重载按它重建） */
export declare const ENTRY_ID = "im-tuitui";
/**
 * 注册版本/更新面板路由（设置页「关于」区块）。
 *
 * 与凭据是否配置无关：没绑定时也想看到「装的是哪一版」，所以 apply 里
 * 两分支都会调它。热重载能力在这里探测一次（宿主可能没装 dsh-hmr）。
 */
export declare function registerAboutPanel(ctx: Context, logger: Logger, config: ImTuituiConfig): void;
/**
 * 凭据已配置的 fiber 注册常驻路由（状态回显 + 手动编辑/更换 + 配置编辑）。
 *
 * 在 apply 的 bootstrapGateway 之前调用；写入经同一 persist 路径，
 * 保存后触发 HMR 重载、新 fiber 以新凭据重启网关。
 */
export declare function registerBoundCredentialRoutes(ctx: Context, logger: Logger, appId: string, config: ImTuituiConfig): void;
//# sourceMappingURL=index.d.ts.map
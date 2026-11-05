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
 * 推推无扫码：ensureCredentials 不做「等待扫码结果」的挂起 Promise——
 * 向导打印完即 resolve null，凭据由用户手填后经 persist 落盘。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ImTuituiConfig } from '../config.ts';
import type { BindStateWire, BotInfoWire } from '../shared/bind-protocol.ts';
import type { Logger } from '../types.ts';
import { BindingService } from './binding-service.ts';
import { registerBindRoutes, type WebServerLike } from './bind-routes.ts';
import { registerAboutRoutes } from './about-routes.ts';
import { createHotReload } from './hot-reload.ts';
import { getProfileDir } from '../shared/index.ts';
import { createTerminalPresenter, isDesktopHost } from './presenters.ts';
import type { SetupCredentials } from './persist.ts';
import { createTuituiClient, describeApiError } from '../tuitui/client.ts';

export type { SetupCredentials } from './persist.ts';
export { persistCredentialsToProfile } from './persist.ts';
export { isDesktopHost } from './presenters.ts';

/** 进程内活动绑定服务（HMR 接管用） */
let activeService: BindingService | null = null;

/** ensureCredentials 参数 */
export interface EnsureCredentialsOptions {
  logger: Logger;
  /** 当前生效配置（apply 时 loader 合并值；端点覆盖与 config 路由 GET 回显共用） */
  config: ImTuituiConfig;
}

/** ctx 的 webServer 注入与 effect 局部投影（cordis 访问守卫要求经 inject 声明） */
interface WebServerContextLike {
  inject(deps: readonly string[], callback: (scoped: Context) => void): unknown;
}

/**
 * 把一组路由的注册挂到 webServer 的作用域上。
 *
 * deps 未就绪时回调不运行但插件照常加载（CLI profile），服务就绪/替换时
 * 回调重跑（自动清理旧路由、注册新路由），与 webserver 的注入生命周期对齐。
 */
function withWebServer(
  ctx: Context,
  register: (webServer: WebServerLike) => () => void,
): void {
  const inject = (ctx as unknown as Partial<WebServerContextLike>).inject;
  if (typeof inject !== 'function') return; // 极简宿主（单测/嵌入）没有 inject：跳过端内路由
  inject.call(ctx, ['webServer'], (scoped) => {
    const webServer = (scoped as unknown as { webServer?: unknown }).webServer as WebServerLike | undefined;
    if (webServer === undefined || typeof webServer.register !== 'function') return;
    const disposeRoutes = register(webServer);
    // 回调作用域（服务卸载/替换、插件卸载）连带注销路由
    (scoped as unknown as { effect(fn: () => (() => void), name?: string): void })
      .effect(() => disposeRoutes, 'im-tuitui.bind-routes');
  });
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
export async function ensureCredentials(
  ctx: Context,
  options: EnsureCredentialsOptions,
): Promise<SetupCredentials | null> {
  const logger = options.logger;
  const config = options.config;

  // 单例接管：HMR 双 fiber 窗口下，新实例终止旧实例
  const service = new BindingService({ logger, config });
  if (activeService !== null && activeService !== service) {
    activeService.dispose();
  }
  activeService = service;

  // 生命周期：fiber dispose 时终止状态机（之后迟到的校验结果一律丢弃）
  (ctx as unknown as { effect(fn: () => () => void, name?: string): void }).effect(() => () => {
    service.dispose();
    if (activeService === service) activeService = null;
  }, 'im-tuitui.binding');

  // 呈现策略：终端通道（CLI / dsh web 运营者）；Desktop 无可见终端，跳过
  if (!isDesktopHost()) {
    service.attach(createTerminalPresenter());
  }

  // 端内绑定页路由：校验与保存都回到本服务，端内页面只读投影相位
  withWebServer(ctx, (webServer) => registerBindRoutes(webServer, service, logger, {
    onManualCredentials: (credentials) => service.submitCredentials(credentials),
    onVerify: (credentials) => service.verifyOnly(credentials),
    currentConfig: () => config,
  }));

  return service.start();
}

/** 本插件在 profile 组合树里的入口 id（热重载按它重建） */
export const ENTRY_ID = 'im-tuitui';

/**
 * 注册版本/更新面板路由（设置页「关于」区块）。
 *
 * 与凭据是否配置无关：没绑定时也想看到「装的是哪一版」，所以 apply 里
 * 两分支都会调它。热重载能力在这里探测一次（宿主可能没装 dsh-hmr）。
 */
export function registerAboutPanel(
  ctx: Context,
  logger: Logger,
  config: ImTuituiConfig,
): void {
  const hotReload = createHotReload(ctx, [ENTRY_ID], logger);
  withWebServer(ctx, (webServer) => registerAboutRoutes(webServer, {
    config: () => config,
    logger,
    hotReload,
    profileDir: () => getProfileDir() ?? null,
  }));
}

/**
 * 凭据是否来自环境变量。
 *
 * resolveEnv 的优先级是「显式配置 > 环境变量」：config 里没有字面量 appId
 * （空串 / __FROM_ENV__ 占位 / process.env 表达式）时，实际生效的就是
 * TUITUI_BOT_APPID。此时端内解绑是无效动作（重载后会重新读回），
 * 绑定页据此把解绑置灰为「环境变量只读」。
 */
function credentialsFromEnv(config: ImTuituiConfig): boolean {
  const raw = config.appId.trim();
  return raw === '' || raw === '__FROM_ENV__' || raw.startsWith('process.env');
}

/**
 * 凭据已配置的 fiber 注册常驻路由（状态回显 + 手动编辑/更换 + 配置编辑）。
 *
 * 在 apply 的 bootstrapGateway 之前调用；写入经同一 persist 路径，
 * 保存后触发 HMR 重载、新 fiber 以新凭据重启网关。
 */
export function registerBoundCredentialRoutes(
  ctx: Context,
  logger: Logger,
  appId: string,
  config: ImTuituiConfig,
): void {
  const fromEnv = credentialsFromEnv(config);
  let bot: BotInfoWire | undefined;

  // 机器人名称/账号回显：绑定页要展示「哪个机器人已接入」，只有 appId 不够。
  // 一次 property.info，失败只降级为「只显示 appId」，不影响绑定态。
  void createTuituiClient({ ...config, appId }, logger).property
    .info()
    .then((info) => { bot = { name: info.name, uid: info.uid, account: info.account }; })
    .catch((error: unknown) => {
      logger.warn(`im-tuitui: property.info 回显失败（绑定页将只显示 appId）: ${describeApiError(error)}`);
    });

  withWebServer(ctx, (webServer) => registerBindRoutes(webServer, null, logger, {
    boundState: () => {
      const state: Extract<BindStateWire, { phase: 'bound' }> = {
        phase: 'bound',
        appId,
        ...(bot !== undefined ? { botName: bot.name, botAccount: bot.account } : {}),
        ...(fromEnv ? { fromEnv: true } : {}),
      };
      return state;
    },
    currentConfig: () => config,
  }));
}

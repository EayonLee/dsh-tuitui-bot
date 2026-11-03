import { BindingService } from "./binding-service.js";
import { registerBindRoutes } from "./bind-routes.js";
import { createTerminalPresenter, isDesktopHost } from "./presenters.js";
import { createTuituiClient, describeApiError } from "../tuitui/client.js";
export { persistCredentialsToProfile } from "./persist.js";
export { isDesktopHost } from "./presenters.js";
/** 进程内活动绑定服务（HMR 接管用） */
let activeService = null;
/**
 * 把一组路由的注册挂到 webServer 的作用域上。
 *
 * deps 未就绪时回调不运行但插件照常加载（CLI profile），服务就绪/替换时
 * 回调重跑（自动清理旧路由、注册新路由），与 webserver 的注入生命周期对齐。
 */
function withWebServer(ctx, register) {
    const inject = ctx.inject;
    if (typeof inject !== 'function')
        return; // 极简宿主（单测/嵌入）没有 inject：跳过端内路由
    inject.call(ctx, ['webServer'], (scoped) => {
        const webServer = scoped.webServer;
        if (webServer === undefined || typeof webServer.register !== 'function')
            return;
        const disposeRoutes = register(webServer);
        // 回调作用域（服务卸载/替换、插件卸载）连带注销路由
        scoped
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
export async function ensureCredentials(ctx, options) {
    const logger = options.logger;
    const config = options.config;
    // 单例接管：HMR 双 fiber 窗口下，新实例终止旧实例
    const service = new BindingService({ logger, config });
    if (activeService !== null && activeService !== service) {
        activeService.dispose();
    }
    activeService = service;
    // 生命周期：fiber dispose 时终止状态机（之后迟到的校验结果一律丢弃）
    ctx.effect(() => () => {
        service.dispose();
        if (activeService === service)
            activeService = null;
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
/**
 * 凭据是否来自环境变量。
 *
 * resolveEnv 的优先级是「显式配置 > 环境变量」：config 里没有字面量 appId
 * （空串 / __FROM_ENV__ 占位 / process.env 表达式）时，实际生效的就是
 * TUITUI_BOT_APPID。此时端内解绑是无效动作（重载后会重新读回），
 * 绑定页据此把解绑置灰为「环境变量只读」。
 */
function credentialsFromEnv(config) {
    const raw = config.appId.trim();
    return raw === '' || raw === '__FROM_ENV__' || raw.startsWith('process.env');
}
/**
 * 凭据已配置的 fiber 注册常驻路由（状态回显 + 手动编辑/更换 + 配置编辑）。
 *
 * 在 apply 的 bootstrapGateway 之前调用；写入经同一 persist 路径，
 * 保存后触发 HMR 重载、新 fiber 以新凭据重启网关。
 */
export function registerBoundCredentialRoutes(ctx, logger, appId, config) {
    const fromEnv = credentialsFromEnv(config);
    let bot;
    // 机器人名称/账号回显：绑定页要展示「哪个机器人已接入」，只有 appId 不够。
    // 一次 property.info，失败只降级为「只显示 appId」，不影响绑定态。
    void createTuituiClient({ ...config, appId }, logger).property
        .info()
        .then((info) => { bot = { name: info.name, uid: info.uid, account: info.account }; })
        .catch((error) => {
        logger.warn(`im-tuitui: property.info 回显失败（绑定页将只显示 appId）: ${describeApiError(error)}`);
    });
    withWebServer(ctx, (webServer) => registerBindRoutes(webServer, null, logger, {
        boundState: () => {
            const state = {
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
//# sourceMappingURL=index.js.map
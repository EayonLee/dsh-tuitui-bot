import { ConfigSchema } from "./config.js";
import { bootstrapGateway } from "./gateway/index.js";
import { getProfileDir, resolveEnv } from "./shared/index.js";
import { ensureCredentials, persistCredentialsToProfile, registerBoundCredentialRoutes } from "./setup/index.js";
import { withFileLog } from "./shared/index.js";
// ── Cordis 插件元数据 ──
export const name = 'im-tuitui';
export const inject = ['agents'];
export const Config = ConfigSchema;
/** 环境变量名（README / .env.example / 绑定页共用） */
export const APP_ID_ENV = 'TUITUI_BOT_APPID';
export const APP_SECRET_ENV = 'TUITUI_BOT_SECRET';
// ── 插件主体 ──
export async function apply(ctx, config) {
    const agents = ctx.agents;
    // 宿主 logger 转发 + 自己落一份到 ~/.dsh/tuitui.log（排查「为什么没回」靠它）
    const baseLogger = ctx.logger ?? console;
    const logger = withFileLog(baseLogger);
    const appId = resolveEnv(config.appId, APP_ID_ENV);
    const appSecret = resolveEnv(config.appSecret, APP_SECRET_ENV);
    // ── 凭据缺失时唤起端内绑定（推推无扫码：手填 + 在线校验 + 写入 profile） ──
    if (!appId || !appSecret) {
        logger.info('推推机器人凭据未配置，启动绑定引导...');
        // 关键：不 await 绑定结果。boot 会等 Loader 树稳定（loader.await()），
        // 无限期等待用户填写凭据会阻塞 Host ready——Desktop 界面无法进入、
        // Web 的 URL 延迟输出。绑定编排（路由/呈现/生命周期）在
        // ensureCredentials 的同步阶段即完成，凭据就绪后由异步链接管。
        void ensureCredentials(ctx, { logger, config: { ...config } })
            .then((credentials) => {
            if (!credentials) {
                // null 包括：用户取消、手动提交（已另行持久化）、流程失败
                logger.info('绑定流程结束（未获取凭据或已手动配置）');
                return;
            }
            // 持久化到 profile：成功则等待热更新重载，失败则用凭据直接启动。
            // 注意：不写入 process.env——resolveEnv 的 env 回退属于用户显式
            // export 的配置语义，运行时写入会与解绑清理不对齐。
            const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, logger);
            if (persisted) {
                logger.info('配置已保存，等待热更新重新加载...');
                return;
            }
            logger.warn('凭据未能持久化，本次进程将使用内存凭据启动（重启后需重新绑定）');
            void bootstrapGateway(ctx, agents, {
                ...config,
                appId: credentials.appId,
                appSecret: credentials.appSecret,
            }, logger).catch((err) => {
                logger.error(`网关启动失败: ${err instanceof Error ? err.message : String(err)}`);
            });
        })
            .catch((err) => {
            // 全兜：unhandled rejection 会被宿主 fail-loud 判致命
            logger.error(`绑定流程异常: ${err instanceof Error ? err.message : String(err)}`);
        });
        // apply 立即完成，插件 fiber 进入 ACTIVE，Host ready 不再被阻塞
        return;
    }
    // 已绑定：注册常驻路由（状态回显 + 手动编辑/更换凭据 + 配置编辑）
    registerBoundCredentialRoutes(ctx, logger, appId, { ...config });
    const resolvedConfig = { ...config, appId, appSecret };
    await bootstrapGateway(ctx, agents, resolvedConfig, logger);
}
//# sourceMappingURL=index.js.map
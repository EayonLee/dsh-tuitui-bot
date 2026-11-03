/**
 * 推推机器人绑定服务 — 凭据校验状态机（宿主内唯一事实源）
 *
 * 上游是「扫码状态机」：qqbot-connector 在宿主内轮询二维码任务，成功后
 * 直接拿回 appId/appSecret。推推没有扫码，凭据由用户在机器人管理后台创建
 * 后手填，因此状态机收敛为四态：
 *
 *   unconfigured --校验--> validating --成功--> bound
 *                                    \--失败--> failed
 *
 * 安全边界：appSecret 只在宿主内流转——校验用临时客户端、落盘直接写
 * profile patch，端内绑定页（bind-routes）只读投影本服务的相位，
 * 任何响应都不回传 secret。
 */
import { createTuituiClient, describeApiError } from "../tuitui/client.js";
import { getProfileDir } from "../shared/index.js";
import { persistCredentialsToProfile } from "./persist.js";
/**
 * 用临时客户端校验凭据。
 *
 * property.info() 是推推唯一「凭据是否有效」的探针，成功即顺带回显机器人
 * name/uid/account 供绑定页展示。每次校验都新建客户端：凭据可能刚被用户
 * 改动，不能复用已绑定 fiber 的实例（那台实例的 appId 是旧值）；临时实例
 * 不订阅事件，校验完即弃。
 */
export async function verifyTuituiCredentials(credentials, config, logger) {
    try {
        const client = createTuituiClient({ ...config, appId: credentials.appId, appSecret: credentials.appSecret }, logger);
        const info = await client.property.info();
        return { ok: true, bot: { name: info.name, uid: info.uid, account: info.account } };
    }
    catch (error) {
        return { ok: false, error: describeApiError(error) };
    }
}
/**
 * 单个绑定会话的状态机。
 *
 * start() 只推向导、不阻塞（推推没有可等待的扫码任务）；submitCredentials()
 * 串起「校验 → 落盘 → 相位收敛」。dispose() 终止状态机（HMR/卸载），
 * 之后到达的校验结果一律丢弃，避免旧 fiber 复活。
 */
export class BindingService {
    phase;
    listeners = new Set();
    presenters = [];
    verifyFn;
    persistFn;
    logger;
    disposed = false;
    /** 相位代次：并发校验时只让最后一次结果落地（丢弃陈旧结果） */
    runId = 0;
    constructor(options) {
        this.logger = options.logger;
        this.phase = options.initial ?? { kind: 'unconfigured' };
        this.verifyFn = options.verify ?? ((credentials) => verifyTuituiCredentials(credentials, options.config, options.logger));
        this.persistFn = options.persist ?? ((credentials) => {
            const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, options.logger);
            return persisted
                ? { persisted: true }
                : { persisted: false, error: '无法定位 profile 目录或写入失败，请改用环境变量配置' };
        });
    }
    /** 当前相位（路由读取） */
    get currentPhase() {
        return this.phase;
    }
    /** 状态订阅（预留给 SSE 推送等增强） */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    /** 挂载呈现策略（须在 start() 前调用） */
    attach(presenter) {
        this.presenters.push(presenter);
    }
    /** 序列化为线上协议（appSecret 永不出现） */
    wireState() {
        switch (this.phase.kind) {
            case 'unconfigured':
                return { phase: 'unconfigured' };
            case 'validating':
                return { phase: 'validating' };
            case 'failed':
                return { phase: 'failed', reason: this.phase.reason };
            case 'bound':
                return {
                    phase: 'bound',
                    appId: this.phase.appId,
                    ...(this.phase.bot !== undefined ? { botName: this.phase.bot.name, botAccount: this.phase.bot.account } : {}),
                    ...(this.phase.fromEnv === true ? { fromEnv: true } : {}),
                };
        }
    }
    /**
     * 启动绑定流程：推推没有可轮询的扫码任务，这里只把向导推给呈现策略，
     * 然后立即 resolve null。
     *
     * 【同步契约】函数体必须保持无 await：调用方（插件 apply）不等待绑定结果
     * 就完成加载——boot 的 `loader.await()` 会等所有插件 fiber settle，
     * 若这里持续等待用户手填，Host ready 会被阻塞（Desktop 界面无法进入、
     * Web 的 URL 延迟输出）。凭据由端内绑定页提交并写入 profile，随后经
     * HMR 热重载以新凭据重启网关。
     */
    start() {
        for (const presenter of this.presenters)
            presenter.onGuide();
        return Promise.resolve(null);
    }
    /**
     * 仅校验、不落盘（绑定页的「校验」按钮）。
     *
     * 校验成功不等于已绑定（凭据还没写进 profile），因此相位回到校验前的
     * 状态，机器人信息随返回值交给表单展示；校验失败则停在 failed，
     * 让端内页面能直接渲染原因。
     */
    async verifyOnly(credentials) {
        if (this.disposed)
            return { ok: false, error: '绑定流程已终止' };
        const generation = ++this.runId;
        const restore = this.phase;
        this.setPhase({ kind: 'validating' });
        let outcome;
        try {
            outcome = await this.verifyFn(credentials);
        }
        catch (error) {
            // 注入的校验实现可能抛错（网络层未被内部消化）：归入 failed，不向上冒泡
            outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        if (this.disposed || generation !== this.runId)
            return outcome;
        this.setPhase(outcome.ok ? restore : { kind: 'failed', reason: outcome.error });
        return outcome;
    }
    /**
     * 校验通过后落盘（绑定页的「保存」按钮 / 手动更换凭据）。
     *
     * 顺序不可交换：先校验再生效——凭据错了要当场告诉用户，而不是写进
     * profile 触发一次失败的重载。落盘成功即进入 bound 相位，随后宿主
     * HMR 重载以新凭据重启网关。
     */
    async submitCredentials(credentials) {
        const outcome = await this.verifyOnly(credentials);
        if (!outcome.ok)
            return { persisted: false, error: outcome.error };
        if (this.disposed)
            return { persisted: false, error: '绑定流程已终止' };
        const generation = this.runId;
        const persisted = this.persistFn(credentials);
        if (this.disposed || generation !== this.runId)
            return persisted;
        if (!persisted.persisted)
            return persisted;
        this.setPhase({ kind: 'bound', appId: credentials.appId, bot: outcome.bot });
        this.logger.info(`im-tuitui: 凭据已校验并保存 (appId=${credentials.appId})`);
        return { ...persisted, state: this.wireState() };
    }
    /** 终止绑定（插件卸载 / HMR 接管 / 替换） */
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.presenters.length = 0;
        this.listeners.clear();
    }
    setPhase(phase) {
        this.phase = phase;
        for (const presenter of this.presenters)
            presenter.onPhase?.(phase);
        for (const listener of this.listeners)
            listener();
    }
}
//# sourceMappingURL=binding-service.js.map
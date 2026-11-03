import type { ImTuituiConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { BindStateWire, BotInfoWire } from '../shared/bind-protocol.ts';
import type { BindPresenter } from './presenters.ts';
import { type SetupCredentials } from './persist.ts';
/** 凭据在线校验结果（成功时回显机器人信息） */
export type VerifyOutcome = {
    ok: true;
    bot: BotInfoWire;
} | {
    ok: false;
    error: string;
};
/** 校验实现注入点（默认真实 property.info 调用） */
export type VerifyFn = (credentials: SetupCredentials) => Promise<VerifyOutcome>;
/** 凭据落盘结果 */
export interface PersistOutcome {
    /** 是否已持久化（false = 落盘失败，需展示手动配置指引） */
    persisted: boolean;
    /** 失败原因（persisted=false 时回传给表单展示） */
    error?: string;
}
/** 提交结果：附带最新相位，便于表单立即渲染（不必等下一轮轮询） */
export interface SubmitOutcome extends PersistOutcome {
    state?: BindStateWire;
}
/** 绑定状态机相位（宿主内部形态，线上投影见 wireState） */
export type BindPhase = {
    kind: 'unconfigured';
} | {
    kind: 'validating';
} | {
    kind: 'failed';
    reason: string;
} | {
    kind: 'bound';
    appId: string;
    /** property.info 回显的机器人信息（校验通过时才有） */
    bot?: BotInfoWire;
    /** 凭据来自环境变量（端内解绑无效） */
    fromEnv?: boolean;
};
/** 构造参数 */
export interface BindingServiceOptions {
    logger: Logger;
    /** 当前生效配置（校验用的临时客户端需要端点覆盖等配置） */
    config: ImTuituiConfig;
    /** 在线校验注入点（默认真实 property.info） */
    verify?: VerifyFn;
    /** 凭据落盘注入点（默认写 profile patch） */
    persist?: (credentials: SetupCredentials) => PersistOutcome;
    /** 初始相位（缺省 unconfigured） */
    initial?: BindPhase;
}
/**
 * 用临时客户端校验凭据。
 *
 * property.info() 是推推唯一「凭据是否有效」的探针，成功即顺带回显机器人
 * name/uid/account 供绑定页展示。每次校验都新建客户端：凭据可能刚被用户
 * 改动，不能复用已绑定 fiber 的实例（那台实例的 appId 是旧值）；临时实例
 * 不订阅事件，校验完即弃。
 */
export declare function verifyTuituiCredentials(credentials: SetupCredentials, config: ImTuituiConfig, logger: Logger): Promise<VerifyOutcome>;
/**
 * 单个绑定会话的状态机。
 *
 * start() 只推向导、不阻塞（推推没有可等待的扫码任务）；submitCredentials()
 * 串起「校验 → 落盘 → 相位收敛」。dispose() 终止状态机（HMR/卸载），
 * 之后到达的校验结果一律丢弃，避免旧 fiber 复活。
 */
export declare class BindingService {
    private phase;
    private readonly listeners;
    private readonly presenters;
    private readonly verifyFn;
    private readonly persistFn;
    private readonly logger;
    private disposed;
    /** 相位代次：并发校验时只让最后一次结果落地（丢弃陈旧结果） */
    private runId;
    constructor(options: BindingServiceOptions);
    /** 当前相位（路由读取） */
    get currentPhase(): BindPhase;
    /** 状态订阅（预留给 SSE 推送等增强） */
    subscribe(listener: () => void): () => void;
    /** 挂载呈现策略（须在 start() 前调用） */
    attach(presenter: BindPresenter): void;
    /** 序列化为线上协议（appSecret 永不出现） */
    wireState(): BindStateWire;
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
    start(): Promise<SetupCredentials | null>;
    /**
     * 仅校验、不落盘（绑定页的「校验」按钮）。
     *
     * 校验成功不等于已绑定（凭据还没写进 profile），因此相位回到校验前的
     * 状态，机器人信息随返回值交给表单展示；校验失败则停在 failed，
     * 让端内页面能直接渲染原因。
     */
    verifyOnly(credentials: SetupCredentials): Promise<VerifyOutcome>;
    /**
     * 校验通过后落盘（绑定页的「保存」按钮 / 手动更换凭据）。
     *
     * 顺序不可交换：先校验再生效——凭据错了要当场告诉用户，而不是写进
     * profile 触发一次失败的重载。落盘成功即进入 bound 相位，随后宿主
     * HMR 重载以新凭据重启网关。
     */
    submitCredentials(credentials: SetupCredentials): Promise<SubmitOutcome>;
    /** 终止绑定（插件卸载 / HMR 接管 / 替换） */
    dispose(): void;
    private setPhase;
}
//# sourceMappingURL=binding-service.d.ts.map
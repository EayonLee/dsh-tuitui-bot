/**
 * 端内绑定页路由 — /tuitui/im-tuitui/bind
 *
 * 注册在 dsh-host-webserver（ctx.webServer）的具名路由：
 * - Web 模式：页面同源直接访问
 * - Desktop：渲染进程的 fetch 经 IPC 桥自动附加 Host 认证转发
 *
 * 响应只含脱敏的 appId 与机器人回显信息；appSecret 绝不出现在任何响应中。
 * manual/verify 提交走与绑定流程一致的校验 + persist 路径
 * （写入 profile patch → HMR 重载生效）。
 *
 * 与上游差异：推推无扫码，因此没有 refresh 路由；新增 verify 路由供绑定页
 * 「先校验再保存」，避免把错误凭据写进 profile 触发一次失败的重载。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ImTuituiConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { BindingService, VerifyOutcome } from './binding-service.ts';
import { type SetupCredentials } from './persist.ts';
import { BIND_CONFIG_PATH, BIND_MANUAL_PATH, BIND_STATE_PATH, BIND_UNBIND_PATH, BIND_VERIFY_PATH, type BindStateWire } from '../shared/bind-protocol.ts';
export { BIND_CONFIG_PATH, BIND_MANUAL_PATH, BIND_STATE_PATH, BIND_UNBIND_PATH, BIND_VERIFY_PATH };
export type { BindStateWire };
/** dsh-host-webserver 的具名路由注册形状（局部投影，避免硬依赖） */
export interface WebRoute {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
/** ctx.webServer 的局部投影（服务可用性由调用方探测） */
export interface WebServerLike {
    register(route: WebRoute): () => void;
}
/** 手动凭据提交的处理结果 */
export interface ManualSubmitResult {
    /** 是否已持久化（false = 落盘失败，需展示手动配置指引） */
    persisted: boolean;
    /** 失败原因（persisted=false 时回传给表单展示） */
    error?: string;
    /** 成功提示（缺省用统一文案） */
    message?: string;
}
/** 解绑处理结果 */
export interface UnbindResult {
    persisted: boolean;
    error?: string;
}
/** 已绑定态（已配置凭据的 fiber 注入；null 表示未绑定） */
export type BoundStateFn = () => Extract<BindStateWire, {
    phase: 'bound';
}> | null;
/** 路由行为注入 */
export interface BindRoutesOptions {
    /**
     * 已绑定态：返回脱敏的 appId 与机器人回显（可回显，非机密），null 表示未绑定。
     * 已绑定 fiber 注册路由时提供；待绑定流程不提供。
     */
    boundState?: BoundStateFn;
    /** 手动凭据提交处理（默认：在线校验 + persist 到 profile patch） */
    onManualCredentials?: (credentials: SetupCredentials) => Promise<ManualSubmitResult>;
    /** 仅校验不落盘（默认：临时客户端调 property.info） */
    onVerify?: (credentials: SetupCredentials) => Promise<VerifyOutcome>;
    /** 解绑处理（默认：移除 profile patch 中的凭据字段 + 清进程 env） */
    onUnbind?: () => UnbindResult;
    /** 当前生效配置（apply 时 loader 合并后的值，GET 回显用） */
    currentConfig?: () => ImTuituiConfig;
    /** 配置写入（默认：最小合并写入 profile patch） */
    onUpdateConfig?: (patch: Record<string, unknown>) => boolean;
}
/**
 * 注册绑定路由（状态查询 / 校验 / 手动凭据 / 解绑 / 配置读写）。
 *
 * @param webServer - ctx.webServer
 * @param service - 绑定状态机；已绑定 fiber 传 null（无待绑定流程）
 * @param logger - 日志
 * @param options - 行为注入（bound 态回显、manual/verify 处理）
 * @returns 注销函数（与插件 fiber 生命周期绑定）
 */
export declare function registerBindRoutes(webServer: WebServerLike, service: BindingService | null, logger: Logger, options?: BindRoutesOptions): () => void;
//# sourceMappingURL=bind-routes.d.ts.map
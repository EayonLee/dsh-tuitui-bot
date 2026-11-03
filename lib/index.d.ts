/**
 * dsh-tuitui-bot — 360 推推 IM 的 dsh 渠道插件
 *
 * Cordis 插件入口。把推推消息平台作为 dsh 的前端协议驱动。
 * 网关组装（中间件编排 + 事件 + 出站 + 生命周期）见 src/gateway/；
 * 渠道适配（推推 SDK 收发）见 src/tuitui/；
 * 凭据绑定编排（端内绑定页 + 配置路由）见 src/setup/。
 */
import type { Context } from '@deepseek-ai/cordis';
import { type ImTuituiConfig } from './config.ts';
export declare const name = "im-tuitui";
export declare const inject: string[];
export declare const Config: import("@deepseek-ai/schemastery").default<ImTuituiConfig>;
export type { ImTuituiConfig } from './config.ts';
/** 环境变量名（README / .env.example / 绑定页共用） */
export declare const APP_ID_ENV = "TUITUI_BOT_APPID";
export declare const APP_SECRET_ENV = "TUITUI_BOT_SECRET";
export declare function apply(ctx: Context, config: ImTuituiConfig): Promise<void>;
//# sourceMappingURL=index.d.ts.map
/**
 * 推推客户端构造 — 凭据/端点/日志适配的唯一入口
 *
 * 上游（QQ）在这里 new QQBot({ appId, appSecret, transport: 'websocket', baseUrl })；
 * 推推 SDK 只需 appId + appSecret + 可选端点覆盖，事件订阅走 client.event.subscribe。
 */
import { TuituiBotClient } from '@qihoo/tuitui-bot-sdk';
import type { TuituiLogger } from '@qihoo/tuitui-bot-sdk';
import type { ImTuituiConfig } from '../config.ts';
import type { Logger } from '../types.ts';
/**
 * 解析服务端地址。
 *
 * 默认走推推生产环境（SDK 内置 im.live.360.cn:8282/robot）；
 * 私有化部署通过配置项或环境变量覆盖，空串视为未配置（不能把空串传给 SDK，
 * 否则 URL 拼接会退化成相对路径）。
 */
export declare function resolveEndpoints(config: ImTuituiConfig): {
    apiBaseUrl?: string;
    websocketBaseUrl?: string;
};
/**
 * 把插件 Logger 适配成 SDK 的 TuituiLogger。
 *
 * SDK 的 debug 日志带请求体（含完整消息内容），只在 config.debug 时透传，
 * 避免生产日志把用户消息落到磁盘。
 */
export declare function createSdkLogger(logger: Logger, debug: boolean): TuituiLogger;
/** 创建推推 Bot 客户端 */
export declare function createTuituiClient(config: ImTuituiConfig, logger: Logger): TuituiBotClient;
/** 从 SDK 响应里尽最大努力取消息 id（文本/卡片/帖子返回结构不一） */
export declare function extractMessageId(response: unknown): string | undefined;
/**
 * 记录 API 失败详情。
 *
 * 推推错误对象带 endpoint / errcode / status / trans_id（在 response 里），
 * 排查必须完整打印——上游注释里也强调"记录完整错误对象"。
 */
export declare function describeApiError(error: unknown): string;
//# sourceMappingURL=client.d.ts.map
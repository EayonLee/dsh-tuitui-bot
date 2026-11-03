/**
 * 推推客户端构造 — 凭据/端点/日志适配的唯一入口
 *
 * 上游（QQ）在这里 new QQBot({ appId, appSecret, transport: 'websocket', baseUrl })；
 * 推推 SDK 只需 appId + appSecret + 可选端点覆盖，事件订阅走 client.event.subscribe。
 */
import { TuituiBotClient } from '@qihoo/tuitui-bot-sdk';
import { buildUserAgent, resolveEnv } from "../shared/index.js";
/**
 * 解析服务端地址。
 *
 * 默认走推推生产环境（SDK 内置 im.live.360.cn:8282/robot）；
 * 私有化部署通过配置项或环境变量覆盖，空串视为未配置（不能把空串传给 SDK，
 * 否则 URL 拼接会退化成相对路径）。
 */
export function resolveEndpoints(config) {
    const api = resolveEnv(config.apiBaseUrl, 'TUITUI_BOT_API_BASE').trim();
    const ws = resolveEnv(config.websocketBaseUrl, 'TUITUI_BOT_WS_BASE').trim();
    return {
        ...(api ? { apiBaseUrl: api.replace(/\/+$/, '') } : {}),
        ...(ws ? { websocketBaseUrl: ws.replace(/\/+$/, '') } : {}),
    };
}
/**
 * 把插件 Logger 适配成 SDK 的 TuituiLogger。
 *
 * SDK 的 debug 日志带请求体（含完整消息内容），只在 config.debug 时透传，
 * 避免生产日志把用户消息落到磁盘。
 */
export function createSdkLogger(logger, debug) {
    return {
        info: (message, context) => logger.info(`[tuitui] ${message}`, context ?? ''),
        warn: (message, context) => logger.warn(`[tuitui] ${message}`, context ?? ''),
        error: (message, context) => logger.error(`[tuitui] ${message}`, context ?? ''),
        ...(debug
            ? { debug: (message, context) => logger.debug(`[tuitui] ${message}`, context ?? '') }
            : {}),
    };
}
/** 创建推推 Bot 客户端 */
export function createTuituiClient(config, logger) {
    const options = {
        ...resolveEndpoints(config),
        logger: createSdkLogger(logger, config.debug),
    };
    // bundle patch 里的 __FROM_ENV__ 是"从环境变量取"的占位，这里兜底再解析一次，
    // 避免把占位串当凭据（调用方通常已解析，但 --patch 直连源码时可能没解析）。
    const appId = resolveEnv(config.appId, 'TUITUI_BOT_APPID');
    const appSecret = resolveEnv(config.appSecret, 'TUITUI_BOT_SECRET');
    const client = new TuituiBotClient(appId, appSecret, options);
    logger.info(`tuitui client initialized (appId=${config.appId}, UA=${buildUserAgent()})`);
    return client;
}
/** 从 SDK 响应里尽最大努力取消息 id（文本/卡片/帖子返回结构不一） */
export function extractMessageId(response) {
    if (typeof response !== 'object' || response === null)
        return undefined;
    const record = response;
    const direct = record.msgid ?? record.msg_id ?? record.post_id ?? record.postid;
    if (typeof direct === 'string' && direct)
        return direct;
    const list = record.msgids;
    if (Array.isArray(list)) {
        const first = list[0];
        const nested = first?.msgid;
        if (typeof nested === 'string' && nested)
            return nested;
    }
    return undefined;
}
/**
 * 记录 API 失败详情。
 *
 * 推推错误对象带 endpoint / errcode / status / trans_id（在 response 里），
 * 排查必须完整打印——上游注释里也强调"记录完整错误对象"。
 */
export function describeApiError(error) {
    if (typeof error !== 'object' || error === null)
        return String(error);
    const record = error;
    const parts = [record.message].map((v) => (typeof v === 'string' ? v : String(v)));
    for (const key of ['endpoint', 'status', 'errcode']) {
        const value = record[key];
        if (value !== undefined && value !== null && value !== '')
            parts.push(`${key}=${String(value)}`);
    }
    const response = record.response;
    if (response && typeof response === 'object') {
        const transId = response.trans_id;
        if (typeof transId === 'string' && transId)
            parts.push(`trans_id=${transId}`);
        if (typeof response.errmsg === 'string') {
            parts.push(`errmsg=${String(response.errmsg)}`);
        }
    }
    return parts.join(' | ');
}
//# sourceMappingURL=client.js.map
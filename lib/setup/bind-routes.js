import Schema from '@deepseek-ai/schemastery';
import { verifyTuituiCredentials } from "./binding-service.js";
import { persistCredentialsToProfile, removeCredentialsFromProfile, updateProfileConfig, } from "./persist.js";
import { getProfileDir } from "../shared/index.js";
import { BIND_CONFIG_PATH, BIND_MANUAL_PATH, BIND_STATE_PATH, BIND_UNBIND_PATH, BIND_VERIFY_PATH, } from "../shared/bind-protocol.js";
// 协议单一来源：shared/bind-protocol.ts（类型 + 路径常量，客户端共用）
export { BIND_CONFIG_PATH, BIND_MANUAL_PATH, BIND_STATE_PATH, BIND_UNBIND_PATH, BIND_VERIFY_PATH };
/** 访问模式三值（与 config.ts 的 AccessControlConfig 一致） */
const AccessModeSchema = Schema.union(['open', 'allowlist', 'blocklist', 'disabled']);
function booleanSchema(value, name) {
    if (typeof value !== 'boolean')
        throw new TypeError(`${name} 必须是布尔值`);
    return value;
}
function stringSchema(name) {
    return (value) => {
        if (typeof value !== 'string')
            throw new TypeError(`${name} 必须是字符串`);
        if (value.length > 20000)
            throw new TypeError(`${name} 过长`);
        return value;
    };
}
function numberSchema(name, min, max) {
    return (value) => {
        if (typeof value !== 'number' || !Number.isFinite(value))
            throw new TypeError(`${name} 必须是数字`);
        if (value < min || value > max)
            throw new TypeError(`${name} 超出允许范围（${min}~${max}）`);
        return value;
    };
}
function accessModeSchema(name) {
    return (value) => {
        try {
            return AccessModeSchema(value);
        }
        catch {
            throw new TypeError(`${name} 必须是 open / allowlist / blocklist / disabled`);
        }
    };
}
/** 名单类字段：字符串数组，逐项 trim、去空、去重，限制条数与单条长度 */
function stringListSchema(value, name) {
    if (!Array.isArray(value))
        throw new TypeError(`${name} 必须是字符串数组`);
    if (value.length > 500)
        throw new TypeError(`${name} 条数过多（最多 500）`);
    const result = [];
    for (const item of value) {
        if (typeof item !== 'string')
            throw new TypeError(`${name} 的每一项都必须是字符串`);
        const trimmed = item.trim();
        if (trimmed === '')
            continue;
        if (trimmed.length > 200)
            throw new TypeError(`${name} 单项过长（最多 200 字符）`);
        if (!result.includes(trimmed))
            result.push(trimmed);
    }
    return result;
}
/** smart 竞态判定用的三个值 */
function mentionPolicySchema(value) {
    if (value !== 'require' && value !== 'always' && value !== 'smart') {
        throw new TypeError('mentionPolicy 必须是 require / always / smart');
    }
    return value;
}
/**
 * 可经 UI 编辑的配置键（白名单：只收用户必要的字段，其余走 patch/env）。
 *
 * 键名与 shared/bind-protocol.ts 的 ConfigPatchWire 一一对应；含点号的键
 * 读/写都按嵌套路径处理（access.c2cMode → config.access.c2cMode），
 * 因此改一个子项不会把父对象的其余子项固化成字面量。
 */
const EDITABLE_CONFIG_KEYS = [
    'provider', 'model', 'preset', 'cwd',
    'requireMention', 'requireMentionInPost',
    'textChunkLimit', 'streaming',
    'sessionIdleTimeout', 'maxQueue', 'processingTimeoutMs', 'askTimeoutMs', 'historyLimit',
    'showToolResults', 'debug',
    'access.c2cMode', 'access.groupMode', 'access.postMode',
    'access.c2cAllow', 'access.c2cBlock',
    'access.groupAllow', 'access.groupBlock',
    'access.postAllow', 'access.postBlock',
    'mentionPolicy', 'botAliases', 'smartFollowUpMs',
    'interactive.enabled', 'agentSteps.enabled',
];
/** 白名单键的子 Schema（服务端校验：客户端校验仅为体验，安全边界在宿主） */
const EDITABLE_CONFIG_SCHEMAS = {
    provider: stringSchema('provider'),
    model: stringSchema('model'),
    preset: stringSchema('preset'),
    cwd: cwdSchema,
    requireMention: (v) => booleanSchema(v, 'requireMention'),
    requireMentionInPost: (v) => booleanSchema(v, 'requireMentionInPost'),
    textChunkLimit: numberSchema('textChunkLimit', 1, 100000),
    streaming: (v) => booleanSchema(v, 'streaming'),
    sessionIdleTimeout: numberSchema('sessionIdleTimeout', 1000, 24 * 60 * 60 * 1000),
    maxQueue: numberSchema('maxQueue', 1, 1000),
    processingTimeoutMs: numberSchema('processingTimeoutMs', 1000, 24 * 60 * 60 * 1000),
    askTimeoutMs: numberSchema('askTimeoutMs', 1000, 24 * 60 * 60 * 1000),
    historyLimit: numberSchema('historyLimit', 0, 1000),
    showToolResults: (v) => booleanSchema(v, 'showToolResults'),
    debug: (v) => booleanSchema(v, 'debug'),
    'access.c2cMode': accessModeSchema('access.c2cMode'),
    'access.groupMode': accessModeSchema('access.groupMode'),
    'access.postMode': accessModeSchema('access.postMode'),
    'access.c2cAllow': (v) => stringListSchema(v, 'access.c2cAllow'),
    'access.c2cBlock': (v) => stringListSchema(v, 'access.c2cBlock'),
    'access.groupAllow': (v) => stringListSchema(v, 'access.groupAllow'),
    'access.groupBlock': (v) => stringListSchema(v, 'access.groupBlock'),
    'access.postAllow': (v) => stringListSchema(v, 'access.postAllow'),
    'access.postBlock': (v) => stringListSchema(v, 'access.postBlock'),
    mentionPolicy: (v) => mentionPolicySchema(v),
    botAliases: (v) => stringListSchema(v, 'botAliases'),
    smartFollowUpMs: numberSchema('smartFollowUpMs', 5000, 60 * 60 * 1000),
    'interactive.enabled': (v) => booleanSchema(v, 'interactive.enabled'),
    'agentSteps.enabled': (v) => booleanSchema(v, 'agentSteps.enabled'),
};
/**
 * Agent 工作目录校验：必须是绝对路径。
 *
 * 所有会话共用这一个目录（与上游 QQ 插件一致）；相对路径会随宿主进程 cwd
 * 漂移，因此直接拒绝。空串/纯空白视为「沿用默认」，由 config 层回落。
 */
function cwdSchema(value) {
    if (typeof value !== 'string')
        throw new Error('cwd 必须是字符串');
    const trimmed = value.trim();
    if (trimmed === '')
        return '';
    if (trimmed.length > 1024)
        throw new Error('cwd 过长');
    if (trimmed.includes('\0'))
        throw new Error('cwd 含非法字符');
    if (!trimmed.startsWith('/'))
        throw new Error('cwd 必须是绝对路径');
    return trimmed;
}
/** manual / verify 请求体大小上限（appId + appSecret 远小于此值） */
const MAX_MANUAL_BODY_BYTES = 4096;
/**
 * config 请求体大小上限：对齐 Schema 的业务边界——白名单字符串字段单个
 * 允许 20000 字符（全中文 UTF-8 约 60KB）。上限只是反滥用闸门，语义校验在 Schema。
 */
const MAX_CONFIG_BODY_BYTES = 512 * 1024;
/** 读取嵌套配置值（按点号路径；任一层不是对象则视为未设置） */
function readPath(source, dottedKey) {
    let node = source;
    for (const segment of dottedKey.split('.')) {
        if (typeof node !== 'object' || node === null)
            return undefined;
        node = node[segment];
    }
    return node;
}
/** 把当前生效配置投影成端内表单可直接回显的扁平快照 */
function projectConfig(current) {
    const snapshot = {};
    for (const key of EDITABLE_CONFIG_KEYS) {
        const value = readPath(current, key);
        if (value !== undefined)
            snapshot[key] = value;
    }
    if (typeof current.cwd === 'string')
        snapshot.cwd = current.cwd;
    return snapshot;
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
export function registerBindRoutes(webServer, service, logger, options = {}) {
    const handleVerify = options.onVerify ?? ((credentials) => {
        const current = options.currentConfig?.();
        // 未注入配置时（单测/极简宿主）用凭据本身构造端点中立的临时配置：
        // 校验只需要 appId/appSecret 与默认生产端点
        const config = current ?? { ...credentials, debug: false };
        return verifyTuituiCredentials(credentials, config, logger);
    });
    const defaultManual = async (credentials) => {
        const outcome = await handleVerify(credentials);
        if (!outcome.ok)
            return { persisted: false, error: outcome.error };
        const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, logger);
        return persisted
            ? { persisted: true }
            : { persisted: false, error: '无法定位 profile 目录或写入失败，请改用环境变量配置' };
    };
    const handleManualSubmit = options.onManualCredentials ?? defaultManual;
    const disposers = [
        webServer.register({
            kind: 'exact',
            path: BIND_STATE_PATH,
            handler: (req, res) => { handleState(req, res, service, options); },
        }),
        webServer.register({
            kind: 'exact',
            path: BIND_VERIFY_PATH,
            handler: (req, res) => handleVerifyRequest(req, res, handleVerify),
        }),
        webServer.register({
            kind: 'exact',
            path: BIND_MANUAL_PATH,
            handler: (req, res) => handleManual(req, res, handleManualSubmit),
        }),
        webServer.register({
            kind: 'exact',
            path: BIND_UNBIND_PATH,
            handler: (req, res) => handleUnbind(req, res, options),
        }),
        webServer.register({
            kind: 'exact',
            path: BIND_CONFIG_PATH,
            handler: (req, res) => handleConfig(req, res, options),
        }),
    ];
    logger.info(`im-tuitui: 端内绑定页已就绪: ${BIND_STATE_PATH}`);
    return () => { for (const dispose of disposers)
        dispose(); };
}
/**
 * 请求来源校验（最小 CSRF 防护）。
 *
 * 带 Origin 的请求必须与 Host 同源；同源 fetch 与 Desktop IPC 桥
 * （后者会删除 origin 头）均放行。本路由数据不敏感且动作无害，
 * 该级别的防护足够。
 */
function trusted(req) {
    const origin = req.headers.origin;
    if (origin === undefined)
        return true;
    try {
        return new URL(origin).host === req.headers.host;
    }
    catch {
        return false;
    }
}
function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(payload);
}
function handleState(req, res, service, options) {
    if (!trusted(req)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
    }
    // 已绑定优先（appSecret 不回传，appId 非机密可回显）
    const bound = options.boundState?.() ?? null;
    if (bound !== null) {
        sendJson(res, 200, bound);
        return;
    }
    // 无绑定服务（已绑定 fiber 未注入 boundState 的异常态）按未配置处理，
    // 端内页面据此展示手填表单，而不是卡在「加载中」
    sendJson(res, 200, service?.wireState() ?? { phase: 'unconfigured' });
}
/** 读取并解析 JSON 请求体（带大小上限） */
async function readJsonBody(req, maxBytes = MAX_MANUAL_BODY_BYTES) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = chunk;
        size += buffer.length;
        if (size > maxBytes)
            throw new Error('request body too large');
        chunks.push(buffer);
    }
    if (size === 0)
        throw new Error('empty request body');
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** 校验手动提交的凭据形态（不打印内容） */
function parseCredentials(body) {
    if (typeof body !== 'object' || body === null)
        return null;
    const record = body;
    const appId = typeof record.appId === 'string' ? record.appId.trim() : '';
    const appSecret = typeof record.appSecret === 'string' ? record.appSecret.trim() : '';
    if (appId.length === 0 || appSecret.length === 0)
        return null;
    if (appId.length > 128 || appSecret.length > 256)
        return null;
    return { appId, appSecret };
}
/** 仅校验：成功回显机器人信息（不落盘，不改变绑定相位以外的任何状态） */
async function handleVerifyRequest(req, res, verify) {
    if (!trusted(req)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
    }
    if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
    }
    let body;
    try {
        body = await readJsonBody(req);
    }
    catch (err) {
        sendJson(res, 400, { ok: false, error: `invalid request body: ${err instanceof Error ? err.message : String(err)}` });
        return;
    }
    const credentials = parseCredentials(body);
    if (credentials === null) {
        sendJson(res, 400, { ok: false, error: 'appId 与 appSecret 不能为空' });
        return;
    }
    const outcome = await verify(credentials);
    if (!outcome.ok) {
        sendJson(res, 400, { ok: false, error: outcome.error });
        return;
    }
    sendJson(res, 200, {
        ok: true,
        message: `校验通过：${outcome.bot.name}（账号 ${outcome.bot.account}）`,
        bot: outcome.bot,
    });
}
async function handleManual(req, res, submit) {
    if (!trusted(req)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
    }
    if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
    }
    let body;
    try {
        body = await readJsonBody(req);
    }
    catch (err) {
        sendJson(res, 400, { ok: false, error: `invalid request body: ${err instanceof Error ? err.message : String(err)}` });
        return;
    }
    const credentials = parseCredentials(body);
    if (credentials === null) {
        sendJson(res, 400, { ok: false, error: 'appId 与 appSecret 不能为空' });
        return;
    }
    const result = await submit(credentials);
    if (!result.persisted) {
        sendJson(res, 500, { ok: false, error: result.error ?? '保存失败' });
        return;
    }
    // 写入 profile patch 触发 HMR 重载，新 fiber 以新凭据启动网关
    sendJson(res, 200, { ok: true, message: result.message ?? '凭据已保存，插件将自动重载' });
}
/**
 * 解绑：仅已绑定态可执行；移除 profile patch 中的凭据并触发 HMR 重载。
 *
 * 环境变量提供的凭据不可端内解绑：写入 profile 也删不掉部署环境的 export，
 * 重载后 resolveEnv 仍会读回，状态会停在 bound——这是明确告知用户而非
 * 假成功后静默失败。
 */
function handleUnbind(req, res, options) {
    if (!trusted(req)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
    }
    if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
    }
    req.resume();
    const bound = options.boundState?.() ?? null;
    if (bound === null) {
        sendJson(res, 409, { ok: false, error: '当前未绑定' });
        return;
    }
    if (bound.fromEnv === true) {
        sendJson(res, 409, {
            ok: false,
            error: '凭据来自环境变量（TUITUI_BOT_APPID / TUITUI_BOT_SECRET），请在部署环境修改后重启',
        });
        return;
    }
    const result = options.onUnbind === undefined
        ? (() => {
            const removed = removeCredentialsFromProfile(getProfileDir() ?? undefined, undefined);
            if (removed) {
                // 清除进程内凭据：手动绑定成功时可能写入 env（供热更新后的下次
                // apply 兜底读取）；不清则 HMR 重载后新 fiber 仍从 env 读到
                // 凭据，解绑不生效（状态一直停留在 bound）
                delete process.env.TUITUI_BOT_APPID;
                delete process.env.TUITUI_BOT_SECRET;
            }
            return removed
                ? { persisted: true }
                : { persisted: false, error: '无法定位 profile 目录或写入失败，请手动编辑 cordis.patch.yml' };
        })()
        : options.onUnbind();
    if (!result.persisted) {
        sendJson(res, 500, { ok: false, error: result.error ?? '解绑失败' });
        return;
    }
    // 移除后写入触发 HMR 重载，插件回到未绑定态（绑定流程重新可用）
    sendJson(res, 200, { ok: true, message: '已解绑，插件将重载并重新进入绑定流程' });
}
/**
 * 配置读写：
 * - GET：回显当前生效配置（扁平 dotted key 快照，appSecret 永不返回）
 * - POST：白名单 + 逐键 Schema 校验 → 最小写入 profile patch → HMR 重载
 */
async function handleConfig(req, res, options) {
    if (!trusted(req)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
    }
    if (req.method === 'GET') {
        const current = options.currentConfig;
        if (current === undefined) {
            // 无配置注入（极简宿主/单测）时给空快照：端内表单退化为「只读空态」
            sendJson(res, 200, { config: {} });
            return;
        }
        sendJson(res, 200, { config: projectConfig(current()) });
        return;
    }
    let body;
    try {
        body = await readJsonBody(req, MAX_CONFIG_BODY_BYTES);
    }
    catch (err) {
        sendJson(res, 400, { ok: false, error: `invalid request body: ${err instanceof Error ? err.message : String(err)}` });
        return;
    }
    if (typeof body !== 'object' || body === null) {
        sendJson(res, 400, { ok: false, error: '请求体必须是 JSON 对象' });
        return;
    }
    const submitted = body;
    // 白名单与凭据字段拦截
    for (const key of Object.keys(submitted)) {
        if (!isEditableKey(key)) {
            const reason = key === 'appId' || key === 'appSecret'
                ? '凭据请使用绑定/更换/解绑功能'
                : '不支持的字段';
            sendJson(res, 400, { ok: false, error: `${reason}: ${key}` });
            return;
        }
    }
    // 逐键 Schema 校验（非法值拒绝，返回首个错误）
    const validated = {};
    for (const [key, value] of Object.entries(submitted)) {
        const check = isEditableKey(key) ? EDITABLE_CONFIG_SCHEMAS[key] : undefined;
        if (check === undefined) {
            sendJson(res, 400, { ok: false, error: `不支持的字段: ${key}` });
            return;
        }
        try {
            validated[key] = check(value);
        }
        catch (err) {
            // 校验器的报错要原样回给设置页：只认 TypeError 会让 cwdSchema 这类普通
            // Error 变成 "Error: cwd 必须是绝对路径"，用户看到脏前缀
            sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
            return;
        }
    }
    const persisted = options.onUpdateConfig === undefined
        ? updateProfileConfig(validated, getProfileDir() ?? undefined, undefined)
        : options.onUpdateConfig(validated);
    if (!persisted) {
        sendJson(res, 500, { ok: false, error: '无法定位 profile 目录或写入失败' });
        return;
    }
    sendJson(res, 200, { ok: true, message: '配置已保存，插件将自动重载（进行中的机器人会话将重置）' });
}
/** 键是否在白名单内（类型守卫：让编辑表按 EditableConfigKey 索引） */
function isEditableKey(key) {
    return EDITABLE_CONFIG_KEYS.includes(key);
}
//# sourceMappingURL=bind-routes.js.map
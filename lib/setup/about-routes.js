import { ABOUT_PATH, PACKAGE_NAME, REPO_SLUG, REPO_URL, UPDATE_APPLY_PATH, UPDATE_CHECK_PATH, UPDATE_REQUEST_HEADER, } from "../shared/about-protocol.js";
import { checkLatest, isNewer } from "./version-check.js";
import { applyUpdate, hasPnpm, planUpdate, readInstalledPackage, } from "./self-update.js";
export { ABOUT_PATH, UPDATE_APPLY_PATH, UPDATE_CHECK_PATH };
/** 默认 fetch：把 Response 收窄成我们用的形状 */
const defaultFetch = async (url, init) => await fetch(url, init);
/** 同源校验（与绑定路由同一套最小 CSRF 防护） */
function sameOrigin(req) {
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
/** 是否来自本机（自更新只允许本机触发） */
function loopback(req) {
    const address = req.socket.remoteAddress ?? '';
    const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
    if (normalized === 'localhost' || normalized === '::1')
        return true;
    if (normalized.startsWith('127.'))
        return true;
    if (normalized.startsWith('::ffff:127.'))
        return true;
    return false;
}
/** 写路由的综合防护 */
function trustedWrite(req) {
    if (!sameOrigin(req))
        return false;
    if (!loopback(req))
        return false;
    const marker = req.headers[UPDATE_REQUEST_HEADER];
    const value = Array.isArray(marker) ? marker[0] : marker;
    return value === '1';
}
function sendJson(res, status, payload) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(payload));
}
/** 单飞：同时只允许一个更新在跑 */
let updating = false;
/**
 * 注册「关于 / 检查更新 / 一键更新」三条路由。
 *
 * @returns 注销函数（与插件 fiber 生命周期绑定）
 */
export function registerAboutRoutes(webServer, options) {
    const logger = options.logger;
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    const readInstalled = options.readInstalled ?? readInstalledPackage;
    const resolveProfileDir = options.profileDir ?? (() => null);
    const disposers = [
        webServer.register({
            kind: 'exact',
            path: ABOUT_PATH,
            handler: (req, res) => handleAbout(req, res, options, readInstalled, resolveProfileDir),
        }),
        webServer.register({
            kind: 'exact',
            path: UPDATE_CHECK_PATH,
            handler: (req, res) => handleCheck(req, res, options, fetchImpl, readInstalled),
        }),
        webServer.register({
            kind: 'exact',
            path: UPDATE_APPLY_PATH,
            handler: (req, res) => handleUpdate(req, res, options, fetchImpl, readInstalled, resolveProfileDir),
        }),
    ];
    logger.info('im-tuitui: 版本信息路由已就绪: ' + ABOUT_PATH);
    return () => { for (const dispose of disposers)
        dispose(); };
}
async function handleAbout(req, res, options, readInstalled, resolveProfileDir) {
    if (!sameOrigin(req)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
    }
    const config = options.config();
    let installed = null;
    let versionError = null;
    try {
        installed = await readInstalled();
    }
    catch (err) {
        versionError = err instanceof Error ? err.message : String(err);
    }
    const enabled = config.selfUpdate.enabled;
    const hotReload = options.hotReload.available;
    const reason = !enabled
        ? '自更新未启用（配置项 selfUpdate.enabled）'
        : !hotReload
            ? '宿主没有热重载能力（缺少 @deepseek-ai/dsh-hmr），更新后需重启'
            : undefined;
    const payload = {
        name: installed?.name ?? PACKAGE_NAME,
        version: installed?.version ?? 'unknown',
        repoUrl: REPO_URL,
        repoSlug: REPO_SLUG,
        channel: config.selfUpdate.channel,
        selfUpdate: {
            enabled,
            hotReload,
            ...(reason === undefined ? {} : { reason }),
            ...(versionError === null ? {} : { reason: versionError }),
        },
        runtime: {
            ...(resolveProfileDir() === null ? {} : { profileDir: resolveProfileDir() }),
            packageManager: hasPnpm(options.pnpmCommand),
        },
    };
    sendJson(res, 200, payload);
}
async function handleCheck(req, res, options, fetchImpl, readInstalled) {
    if (!sameOrigin(req)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
    }
    if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
    }
    const config = options.config();
    try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const refresh = url.searchParams.get('refresh') === '1';
        const installed = await readInstalled();
        const lookup = await checkLatest({
            slug: REPO_SLUG,
            channel: config.selfUpdate.channel,
            fetchImpl,
            ...(refresh ? { refresh: true } : {}),
        });
        const payload = {
            ok: lookup.latest !== null,
            current: installed.version,
            latest: lookup.latest,
            hasUpdate: lookup.latest !== null && isNewer(lookup.latest, installed.version),
            ahead: lookup.latest !== null && isNewer(installed.version, lookup.latest),
            source: lookup.source,
            error: lookup.error,
            checkedAt: lookup.checkedAt,
            cached: lookup.cached,
            channel: config.selfUpdate.channel,
        };
        sendJson(res, 200, payload);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        options.logger.warn('im-tuitui: 检查更新失败: ' + message);
        const payload = {
            ok: false,
            current: 'unknown',
            latest: null,
            hasUpdate: false,
            ahead: false,
            source: null,
            error: message,
            checkedAt: Date.now(),
            cached: false,
            channel: config.selfUpdate.channel,
        };
        sendJson(res, 200, payload);
    }
}
async function handleUpdate(req, res, options, fetchImpl, readInstalled, resolveProfileDir) {
    if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: '只接受 POST' });
        return;
    }
    if (!trustedWrite(req)) {
        sendJson(res, 403, { ok: false, error: 'forbidden' });
        return;
    }
    const config = options.config();
    if (!config.selfUpdate.enabled) {
        sendJson(res, 403, { ok: false, error: '自更新未启用（配置项 selfUpdate.enabled）' });
        return;
    }
    if (updating) {
        sendJson(res, 409, { ok: false, error: '已有更新在进行中' });
        return;
    }
    const profileDir = resolveProfileDir();
    if (profileDir === null) {
        sendJson(res, 500, { ok: false, error: '找不到 profile 目录，无法安装' });
        return;
    }
    let installed;
    try {
        installed = await readInstalled();
    }
    catch (err) {
        sendJson(res, 500, { ok: false, error: '读不到当前版本：' + (err instanceof Error ? err.message : String(err)) });
        return;
    }
    updating = true;
    try {
        const lookup = await checkLatest({
            slug: REPO_SLUG,
            channel: config.selfUpdate.channel,
            fetchImpl,
            refresh: true,
        });
        if (lookup.latest === null) {
            sendJson(res, 200, {
                ok: false, from: installed.version, to: null, hotReload: false, restartRequired: false,
                error: '查不到线上版本：' + (lookup.error ?? '未知原因'),
            });
            return;
        }
        if (!isNewer(lookup.latest, installed.version)) {
            sendJson(res, 200, {
                ok: true, from: installed.version, to: installed.version, hotReload: false, restartRequired: false,
                detail: '已是最新版本',
            });
            return;
        }
        const plan = await planUpdate({
            slug: REPO_SLUG,
            channel: config.selfUpdate.channel,
            fetchImpl: fetchImpl,
            latestVersion: lookup.latest,
        });
        options.logger.info('im-tuitui: 开始更新 ' + installed.version + ' → ' + plan.version + '（' + plan.label + '）');
        const outcome = await applyUpdate({
            plan,
            installed,
            deps: {
                fetchImpl: fetchImpl,
                profileDir,
                packageName: PACKAGE_NAME,
                ...(options.pnpmCommand === undefined ? {} : { pnpmCommand: options.pnpmCommand }),
                logger: options.logger,
            },
        });
        // 先把结果发出去：热重载会把处理本请求的 fiber 一起收走
        const willReload = outcome.ok && options.hotReload.available;
        const payload = {
            ok: outcome.ok,
            from: outcome.from,
            to: outcome.to,
            hotReload: willReload,
            restartRequired: outcome.ok && !willReload,
            ...(outcome.error === undefined ? {} : { error: outcome.error }),
            ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
        };
        sendJson(res, 200, payload);
        if (willReload)
            options.hotReload.schedule();
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        options.logger.warn('im-tuitui: 更新失败: ' + message);
        sendJson(res, 200, {
            ok: false, from: installed.version, to: null, hotReload: false, restartRequired: false, error: message,
        });
    }
    finally {
        updating = false;
    }
}
//# sourceMappingURL=about-routes.js.map
/** 缓存时间：6 小时（GitHub 未认证限流 60 次/小时，缓存不是优化是必需） */
export const CHECK_TTL_MS = 6 * 60 * 60 * 1000;
/** 单源超时：8 秒。慢的源不该拖住整个检查 */
export const CHECK_TIMEOUT_MS = 8000;
/**
 * 解析版本号。认 1.2.3 / v1.2.3 / 1.2.3-beta.1 三种写法。
 *
 * 不认就直接返回 0.0.0：宁可判成"很旧"，也不要抛错把整个检查打挂。
 */
export function parseVersion(raw) {
    const text = String(raw ?? '').trim().replace(/^v/i, '');
    const cut = text.indexOf('-');
    const core = cut >= 0 ? text.slice(0, cut) : text;
    const prerelease = cut >= 0 ? text.slice(cut + 1) : '';
    const parts = core.split('.');
    const nums = [
        Number.parseInt(parts[0] ?? '', 10) || 0,
        Number.parseInt(parts[1] ?? '', 10) || 0,
        Number.parseInt(parts[2] ?? '', 10) || 0,
    ];
    return { nums, prerelease };
}
/** 比较两个版本号：a>b 返回 1，a<b 返回 -1，相等 0 */
export function compareVersions(a, b) {
    const left = parseVersion(a);
    const right = parseVersion(b);
    for (let i = 0; i < 3; i += 1) {
        const l = left.nums[i] ?? 0;
        const r = right.nums[i] ?? 0;
        if (l !== r)
            return l > r ? 1 : -1;
    }
    if (left.prerelease === right.prerelease)
        return 0;
    // 正式版比任何预发布都新
    if (left.prerelease === '')
        return 1;
    if (right.prerelease === '')
        return -1;
    return left.prerelease > right.prerelease ? 1 : -1;
}
/** candidate 是否比 current 新 */
export function isNewer(candidate, current) {
    return compareVersions(candidate, current) > 0;
}
/**
 * 从 releases.atom 第一条 entry 里取版本号。
 *
 * 为什么要这个源：GitHub 未认证 API 是 60 次/小时 **按 IP** 计的，办公楼里
 * 一台 NAT 出口很容易被打满（实测 403 rate limit exceeded）。atom 订阅走的是
 * 网页域，不吃这个限流，而且它列的正是"发布会"这一栏，语义和 Release 一致。
 */
export function versionFromAtom(xml) {
    const entry = /<entry\b[\s\S]*?<title>([^<]+)<\/title>/.exec(xml);
    if (entry === null)
        return null;
    const raw = (entry[1] ?? '').trim();
    if (raw === '')
        return null;
    const version = /v?(\d+(?:\.\d+){1,2}(?:-[0-9A-Za-z.]+)?)/.exec(raw);
    return version === null ? null : (version[1] ?? null);
}
/** 从 package.json 形状的对象里取 version */
function versionFromManifest(payload) {
    if (typeof payload !== 'object' || payload === null)
        return null;
    const version = payload.version;
    return typeof version === 'string' && version.trim() !== '' ? version.trim() : null;
}
/** 从 GitHub releases/latest 响应里取 tag_name */
function versionFromRelease(payload) {
    if (typeof payload !== 'object' || payload === null)
        return null;
    const tag = payload.tag_name;
    if (typeof tag !== 'string' || tag.trim() === '')
        return null;
    return tag.trim().replace(/^v/i, '');
}
/**
 * 列出要查的源。
 *
 * release 通道以 GitHub Release 为准（那是用户真正能下载的包）；
 * main 通道看主干 package.json（raw 优先、jsDelivr 兜底，后者有 CDN 缓存，
 * 所以必须取最大而不是先到先得）。
 *
 * 两个通道都带一个"降级源"：API 挂了还能给出一个上限参考，并在 source 里
 * 如实标注，不让用户以为那就是正式发布。
 */
export function buildSources(slug, channel) {
    const release = {
        url: 'https://api.github.com/repos/' + slug + '/releases/latest',
        label: 'GitHub Release',
        parse: versionFromRelease,
    };
    const mainRaw = {
        url: 'https://raw.githubusercontent.com/' + slug + '/HEAD/package.json',
        label: 'GitHub 主干',
        parse: versionFromManifest,
    };
    const mainCdn = {
        url: 'https://cdn.jsdelivr.net/gh/' + slug + '@main/package.json',
        label: 'jsDelivr',
        parse: versionFromManifest,
    };
    const releaseAtom = {
        url: 'https://github.com/' + slug + '/releases.atom',
        label: 'GitHub Release（Atom）',
        kind: 'atom',
        parse: (payload) => (typeof payload === 'string' ? versionFromAtom(payload) : null),
    };
    // release 通道只用 Release：它代表"用户真正能下载到的包"。
    // 早期版本把主干 raw 混进来取最大，结果是主干改了版本号还没发 Release 时，
    // 页面提示「可更新 v0.1.32」，点了却因为 Release 里没有这个 asset 而失败。
    // 宁可查不到，也不报一个装不了的版本。
    // API 与 atom 都是 Release 语义，取最大即可；API 被限流时 atom 顶上
    return channel === 'release' ? [release, releaseAtom] : [mainRaw, mainCdn, release];
}
async function readSource(source, fetchImpl, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
    try {
        const response = await fetchImpl(source.url, {
            signal: controller.signal,
            headers: {
                accept: 'application/json',
                'user-agent': 'dsh-tuitui-bot-version-check',
            },
        });
        if (!response.ok) {
            return { label: source.label, version: null, error: 'HTTP ' + String(response.status) };
        }
        if (source.kind === 'atom') {
            const text = await response.text();
            const version = source.parse(text);
            return { label: source.label, version, error: version === null ? '响应里没有版本号' : null };
        }
        // Release 是 JSON；raw/jsDelivr 也是 JSON；都用 json()，解析失败再看文本
        let payload;
        try {
            payload = await response.json();
        }
        catch {
            const text = await response.text();
            try {
                payload = JSON.parse(text);
            }
            catch {
                return { label: source.label, version: null, error: '响应不是 JSON' };
            }
        }
        const version = source.parse(payload);
        return { label: source.label, version, error: version === null ? '响应里没有版本号' : null };
    }
    catch (err) {
        const reason = err instanceof Error && err.name === 'AbortError' ? '超时' : (err instanceof Error ? err.message : String(err));
        return { label: source.label, version: null, error: reason };
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * 并发查所有源，取最大版本。
 *
 * 全部失败时 latest=null 且 error 汇总各源原因 —— 上层据此显示「检查失败」，
 * 绝不允许落到「已是最新」。
 */
export async function lookupLatest(slug, channel, fetchImpl, timeoutMs = CHECK_TIMEOUT_MS) {
    const sources = buildSources(slug, channel);
    const outcomes = await Promise.all(sources.map((source) => readSource(source, fetchImpl, timeoutMs)));
    let latest = null;
    let source = null;
    let skippedPrerelease = false;
    for (const outcome of outcomes) {
        if (outcome.version === null)
            continue;
        // 预发布（0.1.31-beta.1）默认不算「有新版」：它是给验收用的，
        // 不该让普通用户在设置页点一下就装上去。
        if (parseVersion(outcome.version).prerelease !== '') {
            skippedPrerelease = true;
            continue;
        }
        if (latest === null || compareVersions(outcome.version, latest) > 0) {
            latest = outcome.version;
            source = outcome.label;
        }
    }
    if (latest !== null)
        return { latest, source, error: null };
    const reasons = outcomes.map((outcome) => outcome.label + ': ' + (outcome.error ?? '未知错误')).join('；');
    return {
        latest: null,
        source: null,
        error: skippedPrerelease
            ? '线上只有预发布版本（' + reasons + '），已按稳定版处理，不提示更新'
            : (reasons === '' ? '没有可用的版本源' : reasons),
    };
}
/** 进程内缓存（key = slug + channel） */
const cache = new Map();
/** 清缓存（单测用，也给"强制刷新"留后门） */
export function resetLatestCache() {
    cache.clear();
}
/**
 * 带缓存的查询。
 *
 * @param refresh - true 时绕过缓存（用户点了按钮）
 */
export async function checkLatest(options) {
    const { slug, channel, fetchImpl } = options;
    const ttlMs = options.ttlMs ?? CHECK_TTL_MS;
    const now = options.now ?? Date.now();
    const key = slug + '|' + channel;
    const hit = cache.get(key);
    if (options.refresh !== true && hit !== undefined && now - hit.at < ttlMs) {
        return { ...hit.value, cached: true, checkedAt: hit.at };
    }
    const value = await lookupLatest(slug, channel, fetchImpl, options.timeoutMs);
    // 查失败不写缓存：下一次点按钮应该重新尝试，而不是把"查不到"钉住 6 小时
    if (value.latest !== null)
        cache.set(key, { at: now, value });
    return { ...value, cached: false, checkedAt: now };
}
//# sourceMappingURL=version-check.js.map
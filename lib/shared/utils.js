/**
 * 通用工具函数
 *
 * 纯函数与常量，供插件入口与其他模块复用。
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = resolve(__dirname, '../..');
/** 插件版本号（从 package.json 读取，供 help/version 等展示真实版本） */
export const PLUGIN_VERSION = readPluginVersion();
function readPluginVersion() {
    try {
        const pkgPath = resolve(PLUGIN_ROOT, 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        return pkg.version ?? '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
/**
 * 构造 User-Agent 头
 *
 * 格式: dsh-tuitui-bot/{version} (Node/{nodeVersion}; {platform})
 */
export function buildUserAgent() {
    return `dsh-tuitui-bot/${PLUGIN_VERSION} (Node/${process.versions.node}; ${os.platform()})`;
}
/**
 * 从插件安装路径推导 profile 目录
 *
 * 主策略：逐级向上探测 profile 标志文件（cordis.patch.yml / pnpm-workspace.yaml）。
 * Desktop profile 使用 pnpm workspace 布局，插件嵌套于多级 node_modules，
 * 仅按 node_modules 匹配会命中内层目录而返回错误位置。
 *
 * @param baseDir - 起始目录，缺省为插件根（可注入便于测试）
 */
export function getProfileDir(baseDir = PLUGIN_ROOT) {
    const byPatch = findProfileAncestor(baseDir, (dir) => existsSync(resolve(dir, 'cordis.patch.yml')) ? dir : null);
    if (byPatch !== null)
        return byPatch;
    const byWorkspace = findProfileAncestor(baseDir, (dir) => existsSync(resolve(dir, 'pnpm-workspace.yaml')) ? dir : null);
    if (byWorkspace !== null)
        return byWorkspace;
    // 兜底：npm 浅层布局 / 尚未写入任何标志文件的全新 profile
    let dir = baseDir;
    for (let i = 0; i < 32; i++) {
        if (basename(dir) === 'node_modules')
            return dirname(dir);
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    // link: 安装（symlink）下插件真实路径在 node_modules 之外，正向反推必失败；
    // 反查 profiles/*/node_modules 里指向本插件根的 symlink
    return findProfileBySymlink(baseDir);
}
/** 反查 symlink 命中 profile；多 profile 共享源码时优先当前进程的 profile */
function findProfileBySymlink(baseDir) {
    const home = process.env.DSH_HOME ?? resolve(os.homedir(), '.dsh');
    const profilesRoot = resolve(home, 'profiles');
    if (!existsSync(profilesRoot))
        return null;
    let realBase;
    try {
        realBase = realpathSync(baseDir);
    }
    catch {
        return null;
    }
    const match = (name) => {
        const modules = resolve(profilesRoot, name, 'node_modules');
        // 包名换过（@qihoo → @eayonlee）：不写死 scope，扫一遍 @* 目录，
        // 否则 link: 安装下这条兜底永远匹配不到（#47）
        let scopes;
        try {
            scopes = readdirSync(modules).filter((entry) => entry.startsWith('@'));
        }
        catch {
            return null; // 该 profile 没有任何依赖目录
        }
        for (const scope of scopes) {
            try {
                if (realpathSync(resolve(modules, scope, 'dsh-tuitui-bot')) === realBase) {
                    return resolve(profilesRoot, name);
                }
            }
            catch {
                // 该 scope 下没装本插件或链接损坏，继续看下一个
            }
        }
        return null;
    };
    const current = currentProfileName();
    if (current !== undefined) {
        const exact = match(current);
        if (exact !== null)
            return exact;
    }
    let entries;
    try {
        entries = readdirSync(profilesRoot);
    }
    catch {
        return null;
    }
    for (const name of entries) {
        const hit = match(name);
        if (hit !== null)
            return hit;
    }
    return null;
}
/** 从进程判据解析 profile 名：Electron → desktop；argv 的 --profile 或裸子命令缩写 */
function currentProfileName() {
    if (process.versions.electron !== undefined)
        return 'desktop';
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] ?? '';
        if (arg === '--profile') {
            const next = argv[i + 1];
            if (next !== undefined && !next.startsWith('-'))
                return next;
        }
        else if (arg.startsWith('--profile=')) {
            return arg.slice('--profile='.length);
        }
    }
    const first = argv.find((a) => !a.startsWith('-'));
    if (first !== undefined && first !== 'plugin')
        return first;
    return undefined;
}
/**
 * 沿目录树向上探测 profile 候选：仅接受「已经跨过至少一个名为
 * node_modules 的路径组件」之后命中的目录。
 */
function findProfileAncestor(baseDir, probe) {
    let crossedNodeModules = false;
    let dir = baseDir;
    for (let i = 0; i < 32; i++) {
        if (basename(dir) === 'node_modules')
            crossedNodeModules = true;
        if (crossedNodeModules) {
            const hit = probe(dir);
            if (hit !== null)
                return hit;
        }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
/**
 * 解析环境变量占位配置
 *
 * 支持三种写法：直接值、`__FROM_ENV__`（bundle patch 占位）、`process.env.XXX`。
 */
export function resolveEnv(configValue, envKey) {
    if (configValue && configValue !== '__FROM_ENV__' && !configValue.startsWith('process.env')) {
        return configValue;
    }
    return process.env[envKey] ?? '';
}
/** 格式化相对时间 */
export function formatRelativeTime(ts) {
    if (!ts)
        return '—';
    const diff = Date.now() - ts;
    if (diff < 60_000)
        return `${Math.floor(diff / 1000)}s 前`;
    if (diff < 3_600_000)
        return `${Math.floor(diff / 60_000)}m 前`;
    if (diff < 86_400_000)
        return `${Math.floor(diff / 3_600_000)}h 前`;
    return `${Math.floor(diff / 86_400_000)}d 前`;
}
/** 截断字符串（日志与卡片展示用） */
export function truncate(text, max) {
    if (text.length <= max)
        return text;
    return `${text.slice(0, Math.max(0, max - 1))}…`;
}
//# sourceMappingURL=utils.js.map
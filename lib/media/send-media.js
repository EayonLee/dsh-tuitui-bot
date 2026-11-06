/**
 * 共享的媒体文件发送 — 推推统一走 im.sendFile，图片与文件由 SDK 区分
 *
 * 单一事实源：tuitui_send_file 工具与交付物投递（present 声明的文件）共用
 * 同一套媒体分类与路径白名单，行为不会漂移。
 *
 * 推推只有 im.sendFile 一个入口，SDK 按上传结果的 mediaType 自动发 image 或
 * attachment。因此这里不区分「视频 / 语音」——它们与普通文件同路；
 * 只保留图片的显式分类，且限定为 SDK 认可上传为图片的 JPG/JPEG/PNG/GIF
 * （webp/bmp 等会被 SDK 判为文件，提前走文件通道避免判定分歧）。
 *
 * MediaSource 三种来源（见 types.ts）都在这里归一：本地路径做白名单与
 * 存在性校验；http(s) URL 与内存字节交给 SDK 上传，宿主不预读。
 */
import { stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { MEDIA_ROOT } from "./media-cleaner.js";
import { resolveAgentCwd } from "../shared/dirs.js";
export { resolveAgentCwd };
/** 推推原生图片扩展名（SDK 只把 JPG/JPEG/PNG/GIF 作为图片上传，其余一律按文件） */
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif']);
/**
 * 解析路径的真实形态：存在的部分全部 realpath（防目录级符号链接逃逸），
 * 不存在的尾部段保持词法拼接（macOS 的 /var → /private/var 等系统级
 * symlink 前缀因此被正确展开，不会与 root 的真实前缀错位）。
 */
function realishPath(p) {
    try {
        return realpathSync(p);
    }
    catch {
        const abs = resolve(p);
        const segments = abs.split('/').filter(Boolean);
        for (let i = segments.length; i > 0; i -= 1) {
            const prefix = `/${segments.slice(0, i).join('/')}`;
            try {
                return join(realpathSync(prefix), ...segments.slice(i));
            }
            catch {
                continue;
            }
        }
        return abs;
    }
}
/**
 * 判断 filePath 是否位于 root 目录内（含 root 本身）。
 *
 * root 侧 realpath 解析符号链接；file 不存在时按最近存在祖先解析
 * （存在性由调用方 existsSync/stat 兜底，不应把「文件不存在」误报成
 * 「路径不允许」）；root 不存在则该 root 无效。
 */
export function isWithinRoot(filePath, root) {
    let realRoot;
    try {
        realRoot = realpathSync(root);
    }
    catch {
        return false; // root 不可解析（不存在/坏链接）→ 该 root 无效
    }
    const rel = relative(realRoot, realishPath(filePath));
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
/**
 * 永远拒绝的文件名（大小写不敏感）。与 restrictPaths 无关：
 * 即便用户显式关掉白名单，也不允许把凭据/密钥当作附件发出去。
 */
const ALWAYS_DENIED_BASENAMES = new Set([
    'cordis.patch.yml',
    'cordis.yml',
    'credentials.json',
    'id_rsa',
    'id_dsa',
    'id_ecdsa',
    'id_ed25519',
    '.npmrc',
    '.netrc',
    '.pgpass',
]);
/** 永远拒绝的目录名（路径中任意一段命中即拒绝） */
const ALWAYS_DENIED_DIRS = new Set(['.ssh', '.gnupg', '.aws', '.kube', '.docker']);
/** 永远拒绝的扩展名（私钥/证书/环境变量文件） */
const ALWAYS_DENIED_EXTS = new Set(['.pem', '.key', '.p12', '.pfx']);
/**
 * 敏感路径判定 —— 凭据与密钥不允许作为附件发送。
 *
 * 宿主的 profile 目录（`$DSH_HOME/profiles/**`）整体视为敏感：凭据就写在
 * 里面的 cordis.patch.yml，按目录拒绝比按文件名拒绝更难绕过（profile 可能被
 * 复制成 cordis.patch.yml.bak 之类的名字）。
 */
export function isSensitivePath(filePath) {
    const real = realishPath(filePath);
    const lower = real.toLowerCase();
    const name = basename(lower);
    if (ALWAYS_DENIED_BASENAMES.has(name))
        return true;
    if (/^\.env(\..+)?$/.test(name))
        return true;
    if (name.startsWith('cordis.patch.yml'))
        return true;
    if (atLeastOne(ALWAYS_DENIED_EXTS, (ext) => lower.endsWith(ext)))
        return true;
    if (real.split('/').some((segment) => ALWAYS_DENIED_DIRS.has(segment.toLowerCase())))
        return true;
    const dshHome = process.env.DSH_HOME ?? resolve(homedir(), '.dsh');
    const profilesDir = resolve(dshHome, 'profiles');
    return isWithinRoot(real, profilesDir);
}
function atLeastOne(set, predicate) {
    for (const value of set)
        if (predicate(value))
            return true;
    return false;
}
/**
 * 路径白名单校验。
 *
 * 两道闸，顺序不能换：
 * 1. 敏感路径（凭据/私钥/profile 目录）**永远拒绝**，与 restrictPaths 无关；
 * 2. restrictPaths 打开时限定 media + cwd + extraRoots，关闭时放行其余任意路径。
 */
export function isPathAllowed(filePath, config, cwd) {
    if (isSensitivePath(filePath))
        return false;
    if (!config.restrictPaths)
        return true;
    const roots = [MEDIA_ROOT, cwd, ...config.extraRoots];
    return roots.some((root) => isWithinRoot(filePath, root));
}
/** 远端 URL 的文件名（解析失败用通用名，不影响发送） */
function remoteFilename(url) {
    try {
        const name = basename(new URL(url).pathname);
        return name === '' ? 'file' : decodeURIComponent(name);
    }
    catch {
        return 'file';
    }
}
/** 把 MediaSource 归一成「来源 + 文件名 + 可预检信息」 */
function resolveMediaSource(input, fileName) {
    if (typeof input === 'string') {
        if (/^https?:\/\//i.test(input)) {
            return { source: input, filename: fileName ?? remoteFilename(input), size: 0 };
        }
        return { source: input, filename: fileName ?? basename(input), localPath: input, size: 0 };
    }
    return { source: input, filename: fileName ?? input.filename, size: input.data.byteLength };
}
/**
 * 发送一个媒体文件
 *
 * 本地文件不存在、不是普通文件时返回 missing（不抛错，调用方决定降级文案）；
 * 平台发送失败返回 failed。文件名透传给通用文件通道；caption 交给发送器
 * 决定投递方式（单聊先发说明文本再发附件，团队帖子由 teams.sendFile 自带
 * 文本字段），这里不做第二次发送，避免与发送器语义重复。
 */
export async function sendMediaFile(bot, target, input, opts = {}) {
    const resolved = resolveMediaSource(input, opts.fileName);
    let size = resolved.size;
    if (resolved.localPath !== undefined) {
        try {
            const info = await stat(resolved.localPath);
            if (!info.isFile())
                return { outcome: 'missing' };
            size = info.size;
        }
        catch {
            return { outcome: 'missing' };
        }
    }
    const ext = extname(resolved.filename).toLowerCase();
    const extra = opts.caption !== undefined && opts.caption !== '' ? { caption: opts.caption } : {};
    try {
        const result = IMAGE_EXTS.has(ext)
            ? await bot.sendImage(target, resolved.source, { filename: resolved.filename, ...extra })
            : await bot.sendFile(target, resolved.source, { filename: resolved.filename, ...extra });
        return {
            outcome: 'sent',
            size,
            ...(result.msgId !== undefined ? { messageId: result.msgId } : {}),
        };
    }
    catch (err) {
        return { outcome: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
}
//# sourceMappingURL=send-media.js.map
/**
 * 富媒体下载 — 将推推图片/视频/文件/语音附件安全下载到本地
 *
 * 下载后仅通过本地绝对路径提示模型，由模型通过 tuitui_describe_image / ffmpeg /
 * tool-fs 等工具自行分析。
 *
 * 下载目录固定为 ~/.dsh-tuitui/media（MEDIA_DIR 单一事实源），
 * 文件名用时间戳+随机数防重名，不依赖 agent cwd，便于上述工具稳定访问。
 *
 * 两个注意点：
 * 1. 媒体来源已由 tuitui/inbound.ts 归一化为 InboundAttachment（覆盖 data.images /
 *    video / file / voice 与 _tuitui_media），这里不再解析平台原始 JSON；只有
 *    "缺 url 但有 fileId" 时，才需要外部注入 file.query(fid) 解析器。
 * 2. SSRF 防护只封环回/链路本地/组播：推推是企业内网 IM，媒体 URL 常见 http +
 *    10.x/172.16 文件服务，全量封禁会让附件下载在主场景整体失效。真正的 SSRF
 *    跳板（127/8、169.254/16、组播）仍然拦截，大小上限与超时照旧。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as dns from 'node:dns';
import { MEDIA_DIR } from "../shared/dirs.js";
/** 默认富媒体下载大小上限（MB），可被 media.maxMB 覆盖 */
const DEFAULT_MAX_MB = 200;
/** 下载超时（毫秒） */
const DOWNLOAD_TIMEOUT_MS = 120_000;
/** 是否为图片（兼容裸值 'image' 与 MIME 'image/png'） */
export function isImageContentType(contentType) {
    return contentType === 'image' || contentType?.startsWith('image/') === true;
}
/** 是否为视频（兼容裸值 'video' 与 MIME 'video/mp4'） */
export function isVideoContentType(contentType) {
    return contentType === 'video' || contentType?.startsWith('video/') === true;
}
/** 是否为语音（兼容裸值 'voice' 与 MIME 'audio/mpeg'） */
export function isVoiceContentType(contentType) {
    return contentType === 'voice' || contentType?.startsWith('audio/') === true;
}
/** 归类附件 content_type 为统一类型 */
export function classifyContentType(contentType) {
    if (isImageContentType(contentType))
        return 'image';
    if (isVideoContentType(contentType))
        return 'video';
    if (isVoiceContentType(contentType))
        return 'voice';
    return 'file';
}
/** 处理 `//` 开头的协议相对 URL（补 https:） */
function normalizeUrl(url) {
    return url.startsWith('//') ? `https:${url}` : url;
}
/** 文件名净化：去路径、移除非法字符（保留中文等 Unicode 字符），防止路径穿越 */
function sanitizeFilename(name) {
    const base = basename(name.replace(/\\/g, '/'));
    // 仅替换文件系统非法字符（Windows 保留字符 + 控制字符），保留中文/空格等
    // normalize NFC：统一 Unicode 规范化，避免 macOS(NFD) 与 Linux/Windows(NFC) 存储差异导致路径对不上
    const safe = base
        .replace(/[<>:"|?*\x00-\x1f]/g, '_')
        .trim()
        .normalize('NFC');
    return safe || 'attachment';
}
/** 统一路径分隔符为 `/`（POSIX），Node fs 在 Windows 也接受正斜杠，保证注入路径跨平台一致 */
function toPosixPath(p) {
    return p.split(sep).join('/');
}
/** 防重名：文件名 + 时间戳 + 随机数 */
function uniqueFilename(name) {
    const base = sanitizeFilename(name);
    const ext = extname(base);
    const stem = basename(base, ext);
    const rand = randomBytes(4).toString('hex');
    return `${stem}_${Date.now()}_${rand}${ext}`;
}
/** 从 URL 末段猜文件名（帖子图片常常只有 url，没有 name） */
function filenameFromUrl(url) {
    if (!url)
        return undefined;
    try {
        const pathname = new URL(normalizeUrl(url)).pathname;
        const last = basename(pathname);
        return last && last !== '/' ? last : undefined;
    }
    catch {
        return undefined;
    }
}
/** 无文件名时按类别给个兜底名（图片落盘后还会按 magic bytes 校正扩展名） */
function fallbackFilename(kind, url) {
    return filenameFromUrl(url) ?? `${kind}`;
}
/**
 * 附件的展示名（下载与 inbound 的媒体元数据共用）。
 *
 * 帖子图片/部分文件只给 url 不给 name；两处若各推各的，下载结果就按名字对不上，
 * 模型会被告知"下载失败"。因此把推导收敛到此函数。
 */
export function mediaFilename(att) {
    return att.filename ?? fallbackFilename(classifyContentType(att.mimeType ?? att.kind), att.url);
}
/**
 * 按魔数（magic bytes）识别图片真实扩展名，无法识别返回 undefined。
 *
 * 纯函数、零 I/O：推推网关的 mime_type 未必可靠，只有文件头可靠。
 * 每个分支都带长度守卫，短于所需字节的 buffer 直接落到末尾 undefined。
 */
export function imageExtension(buf) {
    if (buf.length >= 6) {
        const head = buf.subarray(0, 6).toString('latin1');
        if (head === 'GIF87a' || head === 'GIF89a')
            return '.gif';
    }
    if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
        return '.png';
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
        return '.jpg';
    if (buf.length >= 12
        && buf.subarray(0, 4).toString('latin1') === 'RIFF'
        && buf.subarray(8, 12).toString('latin1') === 'WEBP')
        return '.webp';
    if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d)
        return '.bmp';
    return undefined;
}
/**
 * 按图片真实格式修正路径扩展名，保留文件名主体（纯函数）。
 * 未识别 / 已一致 / jpg≈jpeg 时原样返回，避免无意义改名。
 */
export function correctImageExt(path, buf) {
    const realExt = imageExtension(buf);
    const ext = extname(path);
    const declaredExt = ext.toLowerCase();
    if (!realExt || declaredExt === realExt || (realExt === '.jpg' && declaredExt === '.jpeg'))
        return path;
    return `${path.slice(0, path.length - ext.length)}${realExt}`;
}
/** 字节数格式化 */
function formatSize(bytes) {
    if (bytes >= 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    if (bytes >= 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    return `${bytes}B`;
}
// ── SSRF 防护：只封环回 / 链路本地 / 组播（内网文件服务是推推的常态，不能一刀切） ──
const BLOCKED_RANGES = [
    [0x7f000000n, 8], // 127.0.0.0/8 环回
    [0xa9fe0000n, 16], // 169.254.0.0/16 链路本地（云元数据）
    [0xe0000000n, 4], // 224.0.0.0/4 组播
    [0x00000000n, 8], // 0.0.0.0/8 本机
];
function ipToBigInt(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(Number(octet)), 0n);
}
function isBlockedIP(ip) {
    const val = ipToBigInt(ip);
    return BLOCKED_RANGES.some(([mask, prefix]) => (val >> (32n - BigInt(prefix))) === (mask >> (32n - BigInt(prefix))));
}
/** 解析 hostname 并阻断指向环回/链路本地/组播的 URL（SSRF 防护） */
async function assertSafeHostname(hostname) {
    const addresses = await dns.promises.resolve4(hostname).catch(() => []);
    if (addresses.length === 0)
        throw new Error(`DNS resolution failed: ${hostname}`);
    for (const addr of addresses) {
        if (isBlockedIP(addr))
            throw new Error(`SSRF blocked: ${hostname} resolves to non-routable IP ${addr}`);
    }
}
/** 安全下载：仅 http(s) + 环回拦截 + 大小上限 + 超时，返回字节 Buffer（不落盘） */
async function download(url, maxBytes) {
    const parsed = new URL(normalizeUrl(url));
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error(`Only http(s) allowed: ${parsed.protocol}`);
    }
    await assertSafeHostname(parsed.hostname);
    const resp = await fetch(parsed, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!resp.ok)
        throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > maxBytes) {
        throw new Error(`Download exceeds ${Math.floor(maxBytes / 1024 / 1024)}MB`);
    }
    return buf;
}
/**
 * 下载一组附件（跳过语音：纯文本模型消费不了音频，转写由上层中间件负责）
 *
 * 下载失败/超限不阻断整批，逐个记录 debug/warn，由 inbound 的媒体元数据层回退为描述。
 */
export async function downloadMediaAttachments(attachments, media, logger, resolveFileUrl) {
    if (!media.enabled)
        return [];
    const targets = (attachments ?? []).filter(a => a.kind !== 'voice' && (a.url || a.fileId));
    if (targets.length === 0)
        return [];
    mkdirSync(MEDIA_DIR, { recursive: true });
    const maxBytes = (media.maxMB ?? DEFAULT_MAX_MB) * 1024 * 1024;
    const results = [];
    for (const att of targets) {
        const kind = classifyContentType(att.mimeType ?? att.kind);
        const filename = mediaFilename(att);
        if (att.size !== undefined && att.size > maxBytes) {
            logger.debug(`im-tuitui: skip download (${att.size}B too large): ${filename}`);
            continue; // 超限不下载，由 inbound 回退为描述
        }
        // fid 优先用缓存/临时 URL；只有缺 url 时才回头查一次临时 URL
        let sourceUrl = att.url;
        if (!sourceUrl && att.fileId && resolveFileUrl) {
            try {
                sourceUrl = await resolveFileUrl(att.fileId);
            }
            catch (err) {
                logger.warn(`im-tuitui: resolve file url failed: ${filename} — ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        if (!sourceUrl) {
            logger.debug(`im-tuitui: skip download (no url): ${filename}`);
            continue;
        }
        const destPath = toPosixPath(join(MEDIA_DIR, uniqueFilename(filename)));
        let buf;
        try {
            buf = await download(sourceUrl, maxBytes);
        }
        catch (err) {
            logger.warn(`im-tuitui: download failed: ${filename} — ${err instanceof Error ? err.message : String(err)}`);
            continue; // 下载失败不加入结果，由 inbound 回退为描述
        }
        // 图片按真实格式校正扩展名（网关 mime 不可信），落盘到最终路径
        const localPath = kind === 'image' ? toPosixPath(correctImageExt(destPath, buf)) : destPath;
        writeFileSync(localPath, buf);
        logger.debug(`im-tuitui: attachment downloaded: ${filename} (${formatSize(buf.length)}) → ${localPath}`);
        results.push({
            filename,
            kind,
            localPath,
            bytes: buf.length,
        });
    }
    return results;
}
/**
 * 下载一条入站消息（含其引用消息）的全部富媒体，并把结果写回中间件状态。
 *
 * 供 W2 的 attachment 中间件调用：中间件只负责时机，下载策略集中在这里，
 * 保证"哪些算附件、怎么落盘、失败怎么降级"只有一处定义。
 */
export async function downloadMessageMedia(ctx, config, logger, resolveFileUrl) {
    const downloadedFiles = await downloadMediaAttachments(ctx.message.attachments, config.media, logger, resolveFileUrl);
    const downloadedQuoteFiles = await downloadMediaAttachments(ctx.message.reference?.attachments, config.media, logger, resolveFileUrl);
    ctx.state.downloadedFiles = downloadedFiles;
    ctx.state.downloadedQuoteFiles = downloadedQuoteFiles;
    return { downloadedFiles, downloadedQuoteFiles };
}
//# sourceMappingURL=attachment.js.map
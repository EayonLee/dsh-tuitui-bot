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
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { MediaSource, ReplyTarget, TuituiSender } from '../types.ts';
import type { SendFileConfig } from '../config.ts';
import { MEDIA_ROOT } from './media-cleaner.ts';
import { resolveAgentCwd } from '../shared/dirs.ts';

export { resolveAgentCwd };

/**
 * 发送器最小接口（TuituiSender 满足）。
 *
 * 交付物投递与工具只需要这两条原语；用结构子集而非整个 TuituiSender，
 * 测试才能注入假发送器而不必实现流式/卡片/撤回等无关方法。
 */
export type MediaSenderLike = Pick<TuituiSender, 'sendImage' | 'sendFile'>;

/** 推推原生图片扩展名（SDK 只把 JPG/JPEG/PNG/GIF 作为图片上传，其余一律按文件） */
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif']);

/**
 * 解析路径的真实形态：存在的部分全部 realpath（防目录级符号链接逃逸），
 * 不存在的尾部段保持词法拼接（macOS 的 /var → /private/var 等系统级
 * symlink 前缀因此被正确展开，不会与 root 的真实前缀错位）。
 */
function realishPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    const abs = resolve(p);
    const segments = abs.split('/').filter(Boolean);
    for (let i = segments.length; i > 0; i -= 1) {
      const prefix = `/${segments.slice(0, i).join('/')}`;
      try {
        return join(realpathSync(prefix), ...segments.slice(i));
      } catch {
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
export function isWithinRoot(filePath: string, root: string): boolean {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return false; // root 不可解析（不存在/坏链接）→ 该 root 无效
  }
  const rel = relative(realRoot, realishPath(filePath));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** 路径白名单校验：restrictPaths 关闭时放行任意路径，否则限定 media + cwd + extraRoots */
export function isPathAllowed(filePath: string, config: SendFileConfig, cwd: string): boolean {
  if (!config.restrictPaths) return true;
  const roots = [MEDIA_ROOT, cwd, ...config.extraRoots];
  return roots.some((root) => isWithinRoot(filePath, root));
}

/** sendMediaFile 的结果：成功附带元数据；缺失不抛错；失败携带原因供日志与错误信息透出 */
export type SendMediaResult =
  | { outcome: 'sent'; size: number; messageId?: string }
  | { outcome: 'missing' }
  | { outcome: 'failed'; error: string };

/** 归一化后的发送来源（本地路径 / 远端 URL / 内存字节） */
interface ResolvedMediaSource {
  /** 交给 TuituiSender 的来源，直接透传给 SDK 的上传器 */
  source: MediaSource;
  /** 上传文件名（推推按文件名/内容类型判定 image 还是 attachment） */
  filename: string;
  /** 仅本地路径需要预检存在性与大小 */
  localPath?: string;
  /** 内存字节已知长度；远端由 SDK 下载，宿主不预读（记为 0） */
  size: number;
}

/** 远端 URL 的文件名（解析失败用通用名，不影响发送） */
function remoteFilename(url: string): string {
  try {
    const name = basename(new URL(url).pathname);
    return name === '' ? 'file' : decodeURIComponent(name);
  } catch {
    return 'file';
  }
}

/** 把 MediaSource 归一成「来源 + 文件名 + 可预检信息」 */
function resolveMediaSource(input: MediaSource, fileName?: string): ResolvedMediaSource {
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
export async function sendMediaFile(
  bot: MediaSenderLike,
  target: ReplyTarget,
  input: MediaSource,
  opts: { fileName?: string; caption?: string } = {},
): Promise<SendMediaResult> {
  const resolved = resolveMediaSource(input, opts.fileName);
  let size = resolved.size;

  if (resolved.localPath !== undefined) {
    try {
      const info = await stat(resolved.localPath);
      if (!info.isFile()) return { outcome: 'missing' };
      size = info.size;
    } catch {
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
  } catch (err) {
    return { outcome: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

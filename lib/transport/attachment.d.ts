import type { InboundAttachment, Logger, MiddlewareContext } from '../types.ts';
import type { MediaConfig } from '../config.ts';
export type { DownloadedFile } from '../types.ts';
import type { DownloadedFile } from '../types.ts';
/** 附件归类（推推的 mime_type 是标准 MIME，如 image/png、video/mp4、audio/mpeg） */
export type MediaKind = 'image' | 'video' | 'voice' | 'file';
/** fileId → 临时下载 URL 的解析器（由 gateway 注入 client.file.query） */
export type FileUrlResolver = (fileId: string) => Promise<string | undefined>;
/** 是否为图片（兼容裸值 'image' 与 MIME 'image/png'） */
export declare function isImageContentType(contentType?: string): boolean;
/** 是否为视频（兼容裸值 'video' 与 MIME 'video/mp4'） */
export declare function isVideoContentType(contentType?: string): boolean;
/** 是否为语音（兼容裸值 'voice' 与 MIME 'audio/mpeg'） */
export declare function isVoiceContentType(contentType?: string): boolean;
/** 归类附件 content_type 为统一类型 */
export declare function classifyContentType(contentType?: string): MediaKind;
/**
 * 附件的展示名（下载与 inbound 的媒体元数据共用）。
 *
 * 帖子图片/部分文件只给 url 不给 name；两处若各推各的，下载结果就按名字对不上，
 * 模型会被告知"下载失败"。因此把推导收敛到此函数。
 */
export declare function mediaFilename(att: InboundAttachment): string;
/**
 * 按魔数（magic bytes）识别图片真实扩展名，无法识别返回 undefined。
 *
 * 纯函数、零 I/O：推推网关的 mime_type 未必可靠，只有文件头可靠。
 * 每个分支都带长度守卫，短于所需字节的 buffer 直接落到末尾 undefined。
 */
export declare function imageExtension(buf: Buffer): string | undefined;
/**
 * 按图片真实格式修正路径扩展名，保留文件名主体（纯函数）。
 * 未识别 / 已一致 / jpg≈jpeg 时原样返回，避免无意义改名。
 */
export declare function correctImageExt(path: string, buf: Buffer): string;
/**
 * 下载一组附件（跳过语音：纯文本模型消费不了音频，转写由上层中间件负责）
 *
 * 下载失败/超限不阻断整批，逐个记录 debug/warn，由 inbound 的媒体元数据层回退为描述。
 */
export declare function downloadMediaAttachments(attachments: InboundAttachment[] | undefined, media: MediaConfig, logger: Logger, resolveFileUrl?: FileUrlResolver): Promise<DownloadedFile[]>;
/** 下载结果：当前消息与引用消息分开，供 inbound 的媒体元数据层各取所需 */
export interface MessageMediaDownload {
    downloadedFiles: DownloadedFile[];
    downloadedQuoteFiles: DownloadedFile[];
}
/**
 * 下载一条入站消息（含其引用消息）的全部富媒体，并把结果写回中间件状态。
 *
 * 供 W2 的 attachment 中间件调用：中间件只负责时机，下载策略集中在这里，
 * 保证"哪些算附件、怎么落盘、失败怎么降级"只有一处定义。
 */
export declare function downloadMessageMedia(ctx: MiddlewareContext, config: {
    media: MediaConfig;
}, logger: Logger, resolveFileUrl?: FileUrlResolver): Promise<MessageMediaDownload>;
//# sourceMappingURL=attachment.d.ts.map
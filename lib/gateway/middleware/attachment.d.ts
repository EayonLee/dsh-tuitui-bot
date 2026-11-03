import type { ImTuituiConfig } from '../../config.ts';
import type { DownloadedFile, Logger, Middleware, ProcessedAttachment } from '../../types.ts';
/**
 * 下载器返回的产物。
 *
 * 与 W4 的契约：`downloadMessageMedia(ctx, config, logger)` 负责遍历当前消息与
 * 引用消息里的媒体、落盘、归类，并把结果原样交回来；本中间件只做状态写入。
 */
export interface MediaDownloadResult {
    /** 当前消息的附件下载结果 */
    downloadedFiles?: DownloadedFile[];
    /** 归一化后的附件视图（含语音转写） */
    processedAttachments?: ProcessedAttachment[];
    /** 引用消息里附件的下载结果 */
    downloadedQuoteFiles?: DownloadedFile[];
}
export declare function attachmentProcessor(config: ImTuituiConfig, logger: Logger): Middleware;
//# sourceMappingURL=attachment.d.ts.map
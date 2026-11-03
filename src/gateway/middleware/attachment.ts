/**
 * 富媒体下载中间件 — 在链上把图片 / 文件 / 语音落到本地
 *
 * 模型只认本地绝对路径：下载完成后由它在 tool-fs / 视觉工具里自行访问，
 * 而不是把 URL 直接塞进 prompt（很多内网 URL 模型根本抓不到）。
 *
 * 下载失败不阻断消息：附件异常不该让用户连一句话都收不到，记录告警后放行。
 * media.enabled=false 时连下载都不尝试 —— 关掉富媒体就该彻底不落盘。
 *
 * 下载器由 W4 的 transport/attachment.ts 提供（推推的媒体 URL 需要鉴权头，
 * 逻辑与 QQ 完全不同），本中间件只负责「何时调、结果写哪」。
 */
import { downloadMessageMedia } from '../../transport/attachment.ts';
import type { ImTuituiConfig } from '../../config.ts';
import type {
  DownloadedFile,
  InboundAttachment,
  InboundMessage,
  Logger,
  Middleware,
  ProcessedAttachment,
} from '../../types.ts';

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

/**
 * 由归一化附件 + 下载结果推导下游要用的附件视图。
 *
 * transport/inbound 的媒体元数据层读 `state.processedAttachments`（例如带上语音转写
 * 参与拼 prompt），而 W4 的下载器只回下载产物。缺的这部分在这里补齐：
 * 尽量把本地路径关联回去，模型才拿得到「这条语音说了什么、这张图存在哪」。
 */
function deriveProcessedAttachments(
  message: InboundMessage,
  downloadedFiles: DownloadedFile[],
): ProcessedAttachment[] {
  const byFilename = new Map<string, DownloadedFile>();
  for (const file of downloadedFiles) {
    byFilename.set(file.filename, file);
  }

  return (message.attachments ?? []).map((attachment: InboundAttachment): ProcessedAttachment => {
    const local = attachment.filename ? byFilename.get(attachment.filename) : undefined;
    const processed: ProcessedAttachment = {
      type: attachment.kind,
      filename: attachment.filename,
      url: attachment.url,
      size: attachment.size,
      width: attachment.width,
      height: attachment.height,
    };
    if (local?.localPath) processed.localPath = local.localPath;
    if (attachment.asrText) {
      processed.voiceText = attachment.asrText;
      processed.voiceSource = 'asr';
    }
    return processed;
  });
}

export function attachmentProcessor(config: ImTuituiConfig, logger: Logger): Middleware {
  return async (ctx, next) => {
    if (!config.media.enabled) {
      await next();
      return;
    }

    try {
      const result: MediaDownloadResult = await downloadMessageMedia(ctx, config, logger);
      const downloadedFiles = result.downloadedFiles ?? [];
      ctx.state.downloadedFiles = downloadedFiles;
      ctx.state.downloadedQuoteFiles = result.downloadedQuoteFiles ?? [];
      // 下载器若已经给出附件视图就用它的；否则按归一化附件补齐（inbound 依赖这一项）
      ctx.state.processedAttachments = result.processedAttachments
        ?? deriveProcessedAttachments(ctx.message, downloadedFiles);

      if (downloadedFiles.length > 0) {
        logger.debug(`[attachment] 已下载 ${downloadedFiles.length} 个附件`);
      }
    } catch (err) {
      logger.warn(
        `tuitui-bot: 富媒体下载失败（已放行）: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await next();
  };
}

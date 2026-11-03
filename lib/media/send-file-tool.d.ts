import type { Context } from '@deepseek-ai/cordis';
import type { ImTuituiConfig } from '../config.ts';
import type { SessionManager } from '../session/index.ts';
import type { Logger, TuituiSender } from '../types.ts';
/** 工具名（tuitui 前缀避免与其他通道的同名工具冲突） */
export declare const SEND_FILE_TOOL_NAME = "tuitui_send_file";
/** 发送器与分类发送的共享实现见 send-media.ts（媒体分类 + 白名单为单一事实源） */
export type { MediaSenderLike } from './send-media.ts';
/** 注册 tuitui_send_file 工具（tools 服务缺失时优雅降级，不阻断插件启动） */
export declare function registerSendFileTool(ctx: Context, sender: TuituiSender, manager: SessionManager, config: ImTuituiConfig, logger: Logger): void;
//# sourceMappingURL=send-file-tool.d.ts.map
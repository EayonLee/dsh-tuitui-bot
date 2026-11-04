import type { Context } from '@deepseek-ai/cordis';
import type { ImageGenerationConfig } from '../config.ts';
import type { SessionManager } from '../session/index.ts';
import type { Logger, TuituiSender } from '../types.ts';
export declare const DRAW_TOOL_NAME = "tuitui_draw";
export declare function registerDrawTool(ctx: Context, sender: TuituiSender, manager: SessionManager, config: ImageGenerationConfig, logger: Logger): void;
//# sourceMappingURL=draw-tool.d.ts.map
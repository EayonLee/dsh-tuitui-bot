import type { SessionManager } from '../session/index.ts';
import type { ImTuituiConfig } from '../config.ts';
import type { Logger, MiddlewareContext } from '../types.ts';
/**
 * 处理推推入站消息（已经过中间件链）
 *
 * 阻塞等待本轮 turn 收敛（whenIdle），避免后续消息在 turn 运行期间被 followup 打断；
 * 会话创建失败时用 ctx.bot 兜底回复，绝不静默无响应。
 */
export declare function handleInbound(ctx: MiddlewareContext, manager: SessionManager, config: ImTuituiConfig, logger: Logger): Promise<void>;
//# sourceMappingURL=inbound.d.ts.map
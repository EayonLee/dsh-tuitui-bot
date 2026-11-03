/**
 * 网关组装 — 创建推推客户端、编排中间件、注册事件、出站与生命周期
 *
 * 将推推 IM 作为 dsh 的前端协议驱动：入站事件 → 归一化 → 中间件链 → handleInbound → dsh agent，
 * dsh session/event + agent/assistant-stream → outbound → 推推出站。
 *
 * 与上游（QQ）的差异集中在两处：
 * 1. 事件来源：QQ SDK 自带 middleware/bot.on('message')；推推是 client.event.subscribe 的裸事件体，
 *    因此我们自己在 onEvent 里完成归一化 + 中间件分发。
 * 2. 交互回调：QQ 是 interaction 事件 + button_data；推推是 interactive_action 事件 + 卡片回调结构。
 */
import type { Context } from '@deepseek-ai/cordis';
import { type DshAgentRegistry } from '../session/index.ts';
import type { ImTuituiConfig } from '../config.ts';
import type { InboundMessage, Logger, ReplyTarget, TuituiSender } from '../types.ts';
/**
 * 交互回调分发载荷。
 *
 * 两个通道都实现 `handleInteraction(payload): Promise<boolean>`（true = 已消费），
 * 由 button value 里的 `t` 字段路由，避免多通道各自 try 造成误判。
 */
export interface InteractionPayload {
    message: InboundMessage;
    replyTarget: ReplyTarget;
    bot: TuituiSender;
}
/** 从归一化消息推导出站目标 */
export declare function buildReplyTarget(message: InboundMessage): ReplyTarget;
export declare function bootstrapGateway(ctx: Context, agents: DshAgentRegistry, config: ImTuituiConfig, logger: Logger): Promise<void>;
//# sourceMappingURL=bootstrap.d.ts.map
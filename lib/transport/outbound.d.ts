/**
 * 出站处理器 — dsh session/event → 推推消息发送
 *
 * 采用路由器模式：OutboundRouter 持有会话级状态（文本缓冲、工具调用记录），
 * 事件解析归一化在 events.ts，路由按事件类型分发到私有方法。
 *
 * 推推增量：工具调用同时喂给 agent-reporter（client.agent 原生步骤上报），
 * 让推推客户端在执行过程面板里显示"正在调用哪个工具"，而不是只能靠文本刷屏。
 * 上报是尽力而为——reporter 自身吞异常，不影响消息主流程。
 */
import type { SessionManager } from '../session/index.ts';
import type { ImTuituiConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { AgentStepReporter } from '../tuitui/agent-reporter.ts';
import { type OutboundSenderLike } from './outbound-buffer.ts';
import { type ToolsRegistryLike } from './tool-presenter.ts';
import type { DeliverablesDelivererLike } from './deliverables.ts';
import { type RawSessionEvent } from './events.ts';
export type { OutboundSenderLike } from './outbound-buffer.ts';
export type { ToolsRegistryLike } from './tool-presenter.ts';
export { parseStreamFrame } from './events.ts';
/** 出站处理器签名（注册到 ctx.on('session/event')） */
export type OutboundHandler = (session: SessionLike, event: RawSessionEvent) => void;
/** 出站事件入口集合：durable 事件 + 实时流式帧 */
export interface OutboundHandlers {
    /** durable session 事件入口（注册到 ctx.on('session/event')） */
    routeSessionEvent(session: SessionLike, event: RawSessionEvent): void;
    /**
     * 实时流式帧入口（注册到 ctx.on('agent/assistant-stream', ..., { global: true })）。
     *
     * delta 为空串代表"新 attempt 开始"（见 events.parseStreamFrame）：清空累积文本
     * 但保留已开的流式消息——推推 modifyText 是全量替换，用户看到同一条消息被
     * 新内容重写，不会出现两条。
     */
    routeStreamFrame(agentId: string, delta: string): void;
}
/** dsh Session 简化类型 */
export interface SessionLike {
    header: {
        id: string;
    };
}
/**
 * 创建出站事件处理器
 *
 * 返回 durable 事件与实时流式帧两个入口，分别注册到
 * ctx.on('session/event') 与 ctx.on('agent/assistant-stream', ..., { global: true })。
 * toolsRegistry 用于工具结果的结构化展示；deliverer 用于轮末投递 present 声明的交付文件；
 * agentSteps 是推推原生的执行步骤上报器（可空，关闭上报时不传）。
 */
export declare function createOutboundHandler(manager: SessionManager, bot: OutboundSenderLike | import('../types.ts').TuituiSender, config: ImTuituiConfig, logger: Logger, toolsRegistry?: ToolsRegistryLike, deliverer?: DeliverablesDelivererLike, agentSteps?: AgentStepReporter): OutboundHandlers;
//# sourceMappingURL=outbound.d.ts.map
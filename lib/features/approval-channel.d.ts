/**
 * ApprovalChannel — 把 dsh 的审批 seam（`approval/request` waterfall）桥接到推推。
 *
 * 接入方式与上游一致：监听 `approval/request` waterfall，按 `request.agent.id` 路由到
 * 推推会话；非本插件的会话委托链上其他 answerer（`next()`），多通道（Web/TUI）共存。
 *
 * 每个会话同一时间最多一个 pending 审批（审批是阻塞式的）；outcome 是 dsh 协议的
 * 闭合集合，无 allow-always，只提供「允许一次 / 拒绝」两个选择。
 *
 * 传输层差异（这是本文件与上游唯一的实质区别）：
 * - 审批载体：QQ InlineKeyboard → 推推交互卡片（im.sendInteractive）；
 * - 点击回执：INTERACTION_CREATE → interactive_action（由 gateway 分发），
 *   决策后用 im.modifyInteractive 在同一 msgid 上把按钮换成结果（QQ 自动置灰）；
 * - 纯文本兜底：卡片关闭/发送失败时退化为「回复 1 同意 / 2 拒绝」，因此多一个
 *   `tryAnswer` 入口（上游没有：QQ 审批必须有按钮才能作答）。
 */
import type { EventOptions } from '@deepseek-ai/cordis';
import type { TuituiOutboundInteractiveMessage } from '@qihoo/tuitui-bot-sdk';
import type { ChatScope, InboundMessage, Logger, MiddlewareContext, ReplyTarget, SendResult, TuituiSender } from '../types.ts';
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
/** session log 中 tool/call 事件的最小结构（commandOf 回显命令用） */
interface ApprovalSessionEvent {
    type: string;
    data?: {
        callId?: unknown;
        arguments?: unknown;
        [key: string]: unknown;
    };
}
export interface ApprovalRequest {
    agent: {
        id: string;
        /**
         * dsh-agent 的 `Agent.session` 在类型上是必选，但审批请求可能来自跨进程或
         * 投影后的上下文，运行时拿不到 live session（类型契约与运行时的 gap）。此时
         * 只是无法回显命令原文，不应让整个审批失败，故这里标为可选。
         */
        session?: {
            snapshotEvents?(): readonly ApprovalSessionEvent[];
        };
    };
    toolName: string;
    /** 关联的 tool/call 事件 id，用于从 session log 找回被 gate 的命令 */
    callId?: string;
    /** asker 的人类可读解释 */
    reason?: string;
    signal?: AbortSignal;
}
export interface ApprovalSessionRecordLike {
    sessionKey: string;
    scope: ChatScope;
    replyTarget: ReplyTarget;
}
export interface ApprovalChannelManagerLike {
    findBySessionId(sessionId: string): ApprovalSessionRecordLike | undefined;
    getSessionRecord(scope: ChatScope, peerId: string): ApprovalSessionRecordLike | undefined;
}
export interface ApprovalChannelSenderLike {
    sendMarkdown(target: ReplyTarget, content: string): Promise<unknown>;
    sendInteractive(target: ReplyTarget, card: TuituiOutboundInteractiveMessage): Promise<SendResult>;
    modifyInteractive(target: ReplyTarget, msgId: string, card: TuituiOutboundInteractiveMessage): Promise<void>;
}
/** 配置投影（审批按钮校验 allowlist + 卡片主题） */
export interface ApprovalChannelConfigLike {
    access: {
        c2cMode: 'open' | 'allowlist' | 'blocklist' | 'disabled';
        c2cAllow: readonly string[];
    };
    /** 交互卡片投影；缺省视为启用（关闭时退化为文本 + 编号应答） */
    interactive?: {
        enabled?: boolean;
        headBgColor?: string;
        headTextColor?: string;
    };
}
/** approval/request waterfall 的 answerer handler */
export interface ApprovalChannelContext {
    on(event: string, handler: (...args: unknown[]) => unknown, options?: EventOptions): () => boolean;
}
/** 交互回调分发载荷（与 gateway 的 InteractionPayload 同构） */
export interface ApprovalInteractionPayload {
    message: InboundMessage;
    replyTarget: ReplyTarget;
    bot: TuituiSender;
}
export declare class ApprovalChannel {
    private readonly pending;
    private readonly manager;
    private readonly sender;
    private readonly logger;
    private readonly config;
    constructor(manager: ApprovalChannelManagerLike, sender: ApprovalChannelSenderLike, config: ApprovalChannelConfigLike, logger: Logger);
    /**
     * 注册 approval/request waterfall answerer。
     *
     * 不探测 approval 服务是否已挂载：它是 optional peer，挂载时机可能晚于本插件的
     * apply，一次性探测失败会让通道永久失效。监听事件本身不依赖服务存在——服务就绪后
     * 请求自然经过同一条瀑布，未挂载时不会有请求到达。
     *
     * `global` 是必需的：approval/request 按 agent 作用域派发，根作用域注册的监听器
     * 不带 global 会被作用域过滤掉。
     */
    install(ctx: ApprovalChannelContext): void;
    /** 会话回收时清理其 pending 审批，避免 Promise 悬挂（并把卡片标成已取消） */
    cancelPending(sessionKey: string): void;
    /**
     * 文本作答（卡片不可用时的兜底）：解析 "1/同意/允许" 与 "2/拒绝"。
     *
     * 返回 false 表示"这句话不是审批决策"，调用方必须继续走常规消息流程——
     * 审批挂起期间用户完全可能在聊别的。
     */
    tryAnswer(scope: ChatScope, peerId: string, text: string, clicker?: {
        account?: string;
        uid?: string;
    }): boolean;
    /** 中间件入口：从上下文的正文回答待批审批（W2 的 question-answer 中间件调用） */
    answerFromText(ctx: MiddlewareContext): boolean;
    /** 卡片按钮点击：解码 value、校验点击者授权、settle pending 审批并原地改写卡片 */
    handleInteraction(payload: ApprovalInteractionPayload): Promise<boolean>;
    /** 走推推通道：发审批卡片 + 挂起 Promise，等待用户决策 */
    private park;
    /**
     * 发送审批请求：卡片优先，卡片失败/被关闭时退回纯文本编号提示。
     *
     * 返回卡片 msgid（有的话）——文本作答时要把同一张卡片改成结果态，否则旧按钮
     * 还能被继续点击。
     */
    private sendApprovalRequest;
    /** 结算后把卡片改成结果态（同步路径用，失败不打扰用户） */
    private updateResolvedCard;
    private updateResolvedCardAsync;
    /**
     * 点击者白名单校验。
     *
     * 上游只校验一个 openid；推推同时有域账号与 uid，名单里两种写法都可能出现，
     * 任一命中即放行。身份完全缺失时 fail-closed。
     */
    private isClickerAllowed;
    private cardsEnabled;
    private theme;
    private removeAbort;
}
export {};
//# sourceMappingURL=approval-channel.d.ts.map
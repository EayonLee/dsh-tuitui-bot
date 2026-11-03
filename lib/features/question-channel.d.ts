/**
 * QuestionChannel — 把 dsh 的 ask_user_question 桥接到推推通道。
 *
 * 接入方式：包装 `userQuestions.ask`（而非 registerProvider），按
 * `request.agent.id` 路由到推推会话；非本插件的会话委托宿主默认 provider
 * （Web 弹出框等），多通道共存。
 *
 * 每会话一个显式状态机，三态语义：
 *   - 待答（pending 中）：等待当前题的回答
 *   - 逐题推进：多问题时一次问一题，答完一题再问下一题
 *   - 完成 / 中断（abort / 超时 / 会话回收）：reject(ASK_ABORTED)
 *
 * 传输层：交互卡片 + interactive_action；点完按钮要 modifyInteractive 把卡片
 * 改成"已回答"，因为平台不会自动把按钮置灰。
 */
import type { TuituiOutboundInteractiveMessage } from '@qihoo/tuitui-bot-sdk';
import type { ChatScope, InboundMessage, Logger, MiddlewareContext, ReplyTarget, SendResult, TuituiSender } from '../types.ts';
export interface UserQuestionOption {
    label: string;
    description?: string;
}
export interface UserQuestion {
    id: string;
    header?: string;
    question: string;
    options?: UserQuestionOption[];
    multiSelect?: boolean;
}
export interface UserQuestionAnswer {
    id: string;
    selected: string[];
    custom?: string;
}
export interface UserQuestionRequest {
    questions: UserQuestion[];
    agent?: {
        id?: string;
    };
    signal?: AbortSignal;
}
export interface UserQuestionResult {
    answers: UserQuestionAnswer[];
}
export interface UserQuestionsServiceLike {
    ask: (request: UserQuestionRequest) => Promise<UserQuestionResult>;
    /** 幂等标记：本插件只包装一次 ask，避免热更重入后套娃 */
    __tuituiQuestionPatched?: boolean;
}
export interface QuestionSessionRecordLike {
    sessionKey: string;
    scope: ChatScope;
    replyTarget: ReplyTarget;
}
export interface QuestionChannelManagerLike {
    findBySessionId(sessionId: string): QuestionSessionRecordLike | undefined;
    getSessionRecord(scope: ChatScope, peerId: string): QuestionSessionRecordLike | undefined;
}
export interface QuestionChannelSenderLike {
    sendMarkdown(target: ReplyTarget, content: string): Promise<unknown>;
    sendInteractive(target: ReplyTarget, card: TuituiOutboundInteractiveMessage): Promise<SendResult>;
    modifyInteractive(target: ReplyTarget, msgId: string, card: TuituiOutboundInteractiveMessage): Promise<void>;
}
export interface QuestionChannelConfigLike {
    requireMention: boolean;
    askTimeoutMs: number;
    /** 交互卡片投影；缺省视为启用（关闭时退化为文本 + 编号应答） */
    interactive?: {
        enabled?: boolean;
        headBgColor?: string;
        headTextColor?: string;
    };
}
/** 交互回调分发载荷（与 gateway 的 InteractionPayload 同构） */
export interface QuestionInteractionPayload {
    message: InboundMessage;
    replyTarget: ReplyTarget;
    bot: TuituiSender;
}
export declare class QuestionChannel {
    private readonly pending;
    private uq?;
    private origAsk?;
    private readonly manager;
    private readonly sender;
    private readonly config;
    private readonly logger;
    constructor(manager: QuestionChannelManagerLike, sender: QuestionChannelSenderLike, config: QuestionChannelConfigLike, logger: Logger);
    /**
     * 包装 userQuestions.ask：推推会话走本通道，其余委托原实现。
     * 幂等（已 patch 则跳过）；服务缺失或 ask 非函数时优雅禁用。
     */
    install(ctx: {
        get(name: string): unknown;
    }): void;
    uninstall(): void;
    /** 会话回收时清理其待答问题，避免 pending 悬挂导致 Promise 与闭包泄漏 */
    cancelPending(sessionKey: string): void;
    /**
     * 入站文本作答：该会话若有待答问题且本条消息有文本，解析为答案并推进。
     *
     * 推推的卡片在帖子里不可用、或用户直接打字时都走这条路；问答题的正文里
     * 一直列出了编号，两种作答方式语义一致。
     */
    tryAnswer(scope: ChatScope, peerId: string, text: string): boolean;
    /** 中间件入口：从上下文的正文作答（W2 的 question-answer 中间件调用） */
    answerFromText(ctx: MiddlewareContext): Promise<boolean>;
    /** 卡片按钮点击作答：解码选项下标、推进状态机、原地改写卡片 */
    handleInteraction(payload: QuestionInteractionPayload): Promise<boolean>;
    /** 走推推通道：发送首题 + 挂起 Promise，等待逐题作答 */
    private askViaTuitui;
    /** 推进状态机：收集答案 → 有下一题则发送，否则 resolve 全部答案 */
    private advance;
    /**
     * 发送单个问题：卡片优先，卡片不可用/失败降级纯文本。
     *
     * 返回卡片 msgid（纯文本路径返回 undefined）。多选或无选项时没有按钮可点，
     * 直接发文本——发了没有 action 的卡片只会让用户困惑。
     */
    private sendQuestion;
    private onTimeout;
    /** 已作答卡片回写（同步路径用，失败不打扰用户） */
    private updateAnsweredCard;
    private updateAnsweredCardAsync;
    private resetTimer;
    private clearTimer;
    private cardsEnabled;
    private theme;
    private removeAbort;
}
//# sourceMappingURL=question-channel.d.ts.map
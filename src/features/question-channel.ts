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
import type {
  ChatScope,
  InboundMessage,
  Logger,
  MiddlewareContext,
  ReplyTarget,
  SendResult,
  TuituiSender,
} from '../types.ts';
import { getScopePeer, peerFromSessionKey } from '../shared/scope.ts';
import { parseAnswer } from './answer-parser.ts';
import { buildKeyboard, buildQuestionCard, buildQuestionResolvedCard, formatQuestion } from './question-renderer.ts';
import { decodeButtonData, getInteractiveAction, type CardTheme } from './button-utils.ts';

// ── 最小契约（对齐 dsh-user-questions，避免硬依赖） ──

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
  agent?: { id?: string };
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

// ── 依赖接口（结构化，便于单测） ──

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

// ── 错误语义（对齐 dsh-user-questions 的 UserQuestionError code 约定） ──

/** 问答中断错误码：上层（如 plan-mode）按 code 区分「用户未作答」与普通发送/网络错误 */
const ASK_ABORTED = 'ASK_ABORTED';

class QuestionChannelError extends Error {
  public readonly code: string;

  public constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'QuestionChannelError';
  }
}

// ── 每会话状态机 ──

interface PendingEntry {
  record: QuestionSessionRecordLike;
  request: UserQuestionRequest;
  resolve: (result: UserQuestionResult) => void;
  reject: (err: Error) => void;
  onAbort?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  /** 当前正在问的问题在 request.questions 的下标 */
  index: number;
  /** 已收集的答案 */
  collected: UserQuestionAnswer[];
  /** 当前问题的卡片 msgid（文本作答时用于把卡片改成"已回答"） */
  cardMsgId?: string;
}

export class QuestionChannel {
  private readonly pending = new Map<string, PendingEntry>();
  private uq?: UserQuestionsServiceLike;
  private origAsk?: UserQuestionsServiceLike['ask'];
  private readonly manager: QuestionChannelManagerLike;
  private readonly sender: QuestionChannelSenderLike;
  private readonly config: QuestionChannelConfigLike;
  private readonly logger: Logger;

  public constructor(
    manager: QuestionChannelManagerLike,
    sender: QuestionChannelSenderLike,
    config: QuestionChannelConfigLike,
    logger: Logger,
  ) {
    this.manager = manager;
    this.sender = sender;
    this.config = config;
    this.logger = logger;
  }

  /**
   * 包装 userQuestions.ask：推推会话走本通道，其余委托原实现。
   * 幂等（已 patch 则跳过）；服务缺失或 ask 非函数时优雅禁用。
   */
  public install(ctx: { get(name: string): unknown }): void {
    const uq = ctx.get('userQuestions') as UserQuestionsServiceLike | undefined;
    if (!uq || uq.__tuituiQuestionPatched) return;
    if (typeof uq.ask !== 'function') {
      this.logger.warn('im-tuitui: userQuestions service lacks ask() — tuitui question channel disabled');
      return;
    }

    const self = this;
    this.origAsk = uq.ask.bind(uq);
    uq.ask = async function tuituiRoutedAsk(request: UserQuestionRequest): Promise<UserQuestionResult> {
      const sessionId = request?.agent?.id;
      const record = sessionId ? self.manager.findBySessionId(sessionId) : undefined;
      if (record) return self.askViaTuitui(record, request);
      return self.origAsk!(request);
    };
    Object.defineProperty(uq, '__tuituiQuestionPatched', { value: true, configurable: true, enumerable: false });
    this.uq = uq;
    this.logger.info('im-tuitui: tuitui question channel installed');
  }

  public uninstall(): void {
    if (this.uq && this.origAsk) {
      this.uq.ask = this.origAsk;
      delete this.uq.__tuituiQuestionPatched;
      this.uq = undefined;
      this.origAsk = undefined;
    }
    for (const [, entry] of this.pending) {
      this.clearTimer(entry);
      this.removeAbort(entry);
      entry.reject(new QuestionChannelError('tuitui question channel was unloaded before the user answered', ASK_ABORTED));
    }
    this.pending.clear();
  }

  /** 会话回收时清理其待答问题，避免 pending 悬挂导致 Promise 与闭包泄漏 */
  public cancelPending(sessionKey: string): void {
    const entry = this.pending.get(sessionKey);
    if (!entry) return;
    this.pending.delete(sessionKey);
    this.clearTimer(entry);
    this.removeAbort(entry);
    entry.reject(new QuestionChannelError('ask_user_question was cancelled before the user answered', ASK_ABORTED));
  }

  /**
   * 入站文本作答：该会话若有待答问题且本条消息有文本，解析为答案并推进。
   *
   * 推推的卡片在帖子里不可用、或用户直接打字时都走这条路；问答题的正文里
   * 一直列出了编号，两种作答方式语义一致。
   */
  public tryAnswer(scope: ChatScope, peerId: string, text: string): boolean {
    const record = this.manager.getSessionRecord(scope, peerId);
    if (!record) return false;
    const key = record.sessionKey;
    const entry = this.pending.get(key);
    if (!entry) return false;
    if (!text) return false; // 纯图片/表情等：继续等待，消息走常规流程

    const current = entry.request.questions[entry.index];
    if (!current) return false;
    const answer = parseAnswer(current, text);
    const msgId = entry.cardMsgId;
    this.advance(entry, key, answer);
    this.updateAnsweredCard(record, current, answer, msgId);
    return true;
  }

  /** 中间件入口：从上下文的正文作答（W2 的 question-answer 中间件调用） */
  public async answerFromText(ctx: MiddlewareContext): Promise<boolean> {
    const text = ctx.message.content.trim();
    if (!text) return false;
    const { scope, peerId } = getScopePeer(ctx.message);
    return this.tryAnswer(scope, peerId, text);
  }

  /** 卡片按钮点击作答：解码选项下标、推进状态机、原地改写卡片 */
  public async handleInteraction(payload: QuestionInteractionPayload): Promise<boolean> {
    const click = getInteractiveAction(payload.message);
    if (!click) return false;

    const button = decodeButtonData(click.value);
    if (!button || button.t !== 'question') return false;

    // 主路径按会话找 pending；回调身份字段与入站消息不一致时 sessionKey 会对不上，
    // 那样点了按钮没有任何反应。题目 id 在每个 pending 里唯一，按它兜底一次。
    const record = this.manager.getSessionRecord(click.scope, click.targetId);
    const entry = (record ? this.pending.get(record.sessionKey) : undefined)
      ?? this.findByQuestionIdForClicker(button.q, click);
    if (!entry) return false;

    const current = entry.request.questions[entry.index];
    if (!current) return false;
    // 校验按钮归属题：旧题按钮在新题推进后被点击（误点/延迟事件），
    // 其 q 不等于当前题 id，直接忽略，避免错位映射到当前题选项。
    if (button.q !== current.id) return false;
    const idx = button.i;
    const opts = current.options ?? [];
    if (idx < 0 || idx >= opts.length) return false;
    const option = opts[idx];
    if (!option) return false;

    const answer: UserQuestionAnswer = { id: current.id, selected: [option.label] };
    // 先取卡片 msgid 再推进：advance 会把 entry.cardMsgId 换成下一题的卡片
    const msgId = click.messageId ?? entry.cardMsgId;
    const sessionKey = entry.record.sessionKey;
    this.advance(entry, sessionKey, answer);
    await this.updateAnsweredCardAsync(entry.record, current, answer, msgId);
    return true;
  }

  /**
   * 按题目 id 找待答问题（点击身份对不上会话时的兜底路径）。
   *
   * 和审批一样，兜底必须再核一次点击者对端：题目 id 写在同一张卡片里，
   * 但别人点到那张卡不能替会话主人作答。
   */
  private findByQuestionIdForClicker(
    questionId: string,
    click: { scope: ChatScope; targetId: string; account?: string; uid?: string },
  ): PendingEntry | undefined {
    for (const entry of this.pending.values()) {
      if (entry.request.questions[entry.index]?.id !== questionId) continue;
      const peer = peerFromSessionKey(entry.record.sessionKey, entry.record.scope);
      if (peer && (peer === click.targetId || peer === click.account || peer === click.uid)) return entry;
      this.logger.warn(`im-tuitui: question click matched another peer's entry: key=${entry.record.sessionKey}`);
    }
    return undefined;
  }

  /** 走推推通道：发送首题 + 挂起 Promise，等待逐题作答 */
  private async askViaTuitui(record: QuestionSessionRecordLike, request: UserQuestionRequest): Promise<UserQuestionResult> {
    const key = record.sessionKey;
    // 会话回收/取消可能在发送前发生：signal 已 abort 则直接失败，避免悬挂
    if (request.signal?.aborted) {
      throw new QuestionChannelError('ask_user_question was aborted before delivery', ASK_ABORTED);
    }
    // 同会话已有待答问题（理论上不会发生：回合阻塞在第一个问题上）→ 拒绝旧的
    const prev = this.pending.get(key);
    if (prev) {
      this.pending.delete(key);
      this.clearTimer(prev);
      this.removeAbort(prev);
      prev.reject(new QuestionChannelError('superseded by a new question', ASK_ABORTED));
    }

    const first = request.questions[0];
    if (!first) throw new Error('ask_user_question with empty questions');

    // 先发首题再建 entry：卡片 msgid 要挂到 entry 上，供文本作答回写卡片
    const cardMsgId = await this.sendQuestion(record, first);

    return new Promise<UserQuestionResult>((resolve, reject) => {
      const entry: PendingEntry = {
        record,
        request,
        resolve,
        reject,
        index: 0,
        collected: [],
        ...(cardMsgId ? { cardMsgId } : {}),
      };
      if (request.signal) {
        const onAbort = (): void => {
          if (this.pending.get(key) !== entry) return;
          this.pending.delete(key);
          this.clearTimer(entry);
          reject(new QuestionChannelError('ask_user_question was aborted before the user answered', ASK_ABORTED));
        };
        entry.onAbort = onAbort;
        request.signal.addEventListener('abort', onAbort, { once: true });
      }
      entry.timer = setTimeout(() => this.onTimeout(key), this.config.askTimeoutMs);
      this.pending.set(key, entry);
      this.logger.info(`im-tuitui: question sent to tuitui, waiting for answer key=${key}`);
    });
  }

  /** 推进状态机：收集答案 → 有下一题则发送，否则 resolve 全部答案 */
  private advance(entry: PendingEntry, key: string, answer: UserQuestionAnswer): void {
    entry.collected.push(answer);
    entry.index += 1;

    if (entry.index < entry.request.questions.length) {
      const next = entry.request.questions[entry.index]!;
      this.resetTimer(entry, key);
      void this.sendQuestion(entry.record, next)
        .then((cardMsgId) => {
          entry.cardMsgId = cardMsgId;
        })
        .catch((err: unknown) => {
          this.pending.delete(key);
          this.clearTimer(entry);
          this.removeAbort(entry);
          entry.reject(err instanceof Error ? err : new Error(String(err)));
        });
      return;
    }

    this.pending.delete(key);
    this.clearTimer(entry);
    this.removeAbort(entry);
    this.logger.info(`im-tuitui: question answered via tuitui key=${key}`);
    entry.resolve({ answers: entry.collected });
  }

  /**
   * 发送单个问题：卡片优先，卡片不可用/失败降级纯文本。
   *
   * 返回卡片 msgid（纯文本路径返回 undefined）。多选或无选项时没有按钮可点，
   * 直接发文本——发了没有 action 的卡片只会让用户困惑。
   */
  private async sendQuestion(record: QuestionSessionRecordLike, question: UserQuestion): Promise<string | undefined> {
    const hint = record.scope === 'group' && this.config.requireMention === true;
    const actions = buildKeyboard(question);
    try {
      if (actions && this.cardsEnabled()) {
        try {
          const result = await this.sender.sendInteractive(
            record.replyTarget,
            buildQuestionCard(question, hint, actions, this.theme()),
          );
          return result.msgId;
        } catch (err) {
          this.logger.warn(
            `im-tuitui: question card send failed, fallback to text: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      await this.sender.sendMarkdown(record.replyTarget, formatQuestion(question, hint, false));
      return undefined;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`im-tuitui: question send failed key=${record.sessionKey}: ${msg}`);
      throw new Error(`failed to deliver question to tuitui: ${msg}`);
    }
  }

  private onTimeout(key: string): void {
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    this.removeAbort(entry);
    entry.timer = undefined;
    void this.sender.sendMarkdown(entry.record.replyTarget, '⚠️ 提问已超时，未收到回答。').catch(() => {});
    entry.reject(new QuestionChannelError('ask_user_question timed out before the user answered', ASK_ABORTED));
  }

  /** 已作答卡片回写（同步路径用，失败不打扰用户） */
  private updateAnsweredCard(
    record: QuestionSessionRecordLike,
    question: UserQuestion,
    answer: UserQuestionAnswer,
    msgId: string | undefined,
  ): void {
    void this.updateAnsweredCardAsync(record, question, answer, msgId).catch(() => undefined);
  }

  private async updateAnsweredCardAsync(
    record: QuestionSessionRecordLike,
    question: UserQuestion,
    answer: UserQuestionAnswer,
    msgId: string | undefined,
  ): Promise<void> {
    if (!msgId || !this.cardsEnabled()) return;
    try {
      await this.sender.modifyInteractive(
        record.replyTarget,
        msgId,
        buildQuestionResolvedCard(question, answer, this.theme()),
      );
    } catch (err) {
      // 卡片改写失败不影响答案已经推进，只影响观感
      this.logger.warn(
        `im-tuitui: question card update failed key=${record.sessionKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private resetTimer(entry: PendingEntry, key: string): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.onTimeout(key), this.config.askTimeoutMs);
  }

  private clearTimer(entry: PendingEntry): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  private cardsEnabled(): boolean {
    return this.config.interactive?.enabled !== false;
  }

  private theme(): Partial<CardTheme> | undefined {
    return this.config.interactive;
  }

  private removeAbort(entry: PendingEntry): void {
    if (entry.onAbort && entry.request.signal) {
      entry.request.signal.removeEventListener('abort', entry.onAbort);
    }
  }
}

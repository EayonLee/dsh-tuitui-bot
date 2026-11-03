import { randomUUID } from 'node:crypto';
import { getScopePeer } from "../shared/scope.js";
import { decodeButtonData, getInteractiveAction } from "./button-utils.js";
import { buildApprovalCard, buildApprovalResolvedCard, buildApprovalText, } from "./approval-renderer.js";
import { parseApprovalDecision } from "./answer-parser.js";
const COMMAND_CLIP = 500;
/**
 * 从 session log 按 callId 找回被 gate 的命令（审批请求本身不重复携带 arguments）。
 * 对齐 TUI/web 的 `commandOf` 语义。
 */
function commandOf(req) {
    if (req.callId === undefined)
        return undefined;
    // 审批请求可能来自没有 live session 的上下文（例如跨进程/投影后的 Agent），
    // 此时只是拿不到命令原文，不能因此让整个审批失败。
    const events = req.agent.session?.snapshotEvents?.();
    if (!Array.isArray(events))
        return undefined;
    for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (!event || event.type !== 'tool/call')
            continue;
        const data = event.data;
        if (String(data?.callId) !== String(req.callId))
            continue;
        const raw = data?.arguments;
        if (typeof raw !== 'string')
            return undefined;
        try {
            const parsed = JSON.parse(raw);
            if (parsed !== null && typeof parsed === 'object' && 'command' in parsed) {
                const command = parsed.command;
                if (typeof command === 'string')
                    return command;
            }
        }
        catch {
            // 非 JSON，回退到原始字符串
        }
        return raw.length <= COMMAND_CLIP ? raw : `${raw.slice(0, COMMAND_CLIP)}…`;
    }
    return undefined;
}
export class ApprovalChannel {
    pending = new Map();
    manager;
    sender;
    logger;
    config;
    constructor(manager, sender, config, logger) {
        this.manager = manager;
        this.sender = sender;
        this.config = config;
        this.logger = logger;
    }
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
    install(ctx) {
        const self = this;
        ctx.on('approval/request', (req, next) => {
            const request = req;
            const nextFn = next;
            const record = self.manager.findBySessionId(request.agent.id);
            if (record)
                return self.park(record, request);
            return nextFn();
        }, { global: true, prepend: true });
        this.logger.info('im-tuitui: tuitui approval channel installed');
    }
    /** 会话回收时清理其 pending 审批，避免 Promise 悬挂（并把卡片标成已取消） */
    cancelPending(sessionKey) {
        const entry = this.pending.get(sessionKey);
        if (!entry)
            return;
        this.pending.delete(sessionKey);
        this.removeAbort(entry);
        entry.resolve('cancelled');
        this.updateResolvedCard(entry, 'cancelled', entry.cardMsgId);
    }
    /**
     * 文本作答（卡片不可用时的兜底）：解析 "1/同意/允许" 与 "2/拒绝"。
     *
     * 返回 false 表示"这句话不是审批决策"，调用方必须继续走常规消息流程——
     * 审批挂起期间用户完全可能在聊别的。
     */
    tryAnswer(scope, peerId, text, clicker) {
        const record = this.manager.getSessionRecord(scope, peerId);
        if (!record)
            return false;
        const entry = this.pending.get(record.sessionKey);
        if (!entry)
            return false;
        const decision = parseApprovalDecision(text);
        if (!decision)
            return false;
        if (clicker && !this.isClickerAllowed(clicker)) {
            this.logger.warn(`im-tuitui: approval text answer rejected (sender not allowlisted): user=${clicker.account ?? clicker.uid ?? '(missing)'} key=${record.sessionKey}`);
            return false;
        }
        this.pending.delete(record.sessionKey);
        this.removeAbort(entry);
        const resolution = decision === 'allow' ? 'allowed-once' : 'rejected';
        entry.resolve(resolution);
        this.updateResolvedCard(entry, resolution, entry.cardMsgId);
        return true;
    }
    /** 中间件入口：从上下文的正文回答待批审批（W2 的 question-answer 中间件调用） */
    answerFromText(ctx) {
        const text = ctx.message.content.trim();
        if (!text)
            return false;
        const { scope, peerId } = getScopePeer(ctx.message);
        return this.tryAnswer(scope, peerId, text, {
            ...(ctx.message.senderAccount ? { account: ctx.message.senderAccount } : {}),
            ...(ctx.message.senderId ? { uid: ctx.message.senderId } : {}),
        });
    }
    /** 卡片按钮点击：解码 value、校验点击者授权、settle pending 审批并原地改写卡片 */
    async handleInteraction(payload) {
        const click = getInteractiveAction(payload.message);
        if (!click)
            return false;
        const record = this.manager.getSessionRecord(click.scope, click.targetId);
        if (!record)
            return false;
        const entry = this.pending.get(record.sessionKey);
        if (!entry)
            return false;
        const button = decodeButtonData(click.value);
        if (!button || button.t !== 'approval')
            return false;
        // nonce 必须匹配 pending：旧卡片/其它会话的卡片点击不 settle（#94-3）
        if (button.n !== entry.nonce) {
            this.logger.warn(`im-tuitui: approval button nonce mismatch: key=${record.sessionKey}`);
            return false;
        }
        // 白名单模式下审批只认名单内用户；点击者身份缺失同样拒绝（fail-closed，#94-3）
        if (!this.isClickerAllowed(click)) {
            this.logger.warn(`im-tuitui: approval button rejected (clicker not allowlisted): user=${click.account ?? click.uid ?? '(missing)'} key=${record.sessionKey}`);
            return false;
        }
        this.pending.delete(record.sessionKey);
        this.removeAbort(entry);
        const resolution = button.d === 'allow' ? 'allowed-once' : 'rejected';
        entry.resolve(resolution);
        await this.updateResolvedCardAsync(entry, resolution, click.messageId ?? entry.cardMsgId);
        return true;
    }
    /** 走推推通道：发审批卡片 + 挂起 Promise，等待用户决策 */
    async park(record, request) {
        const key = record.sessionKey;
        // 会话回收/取消可能在发送前发生：signal 已 abort 则直接失败
        if (request.signal?.aborted)
            return 'cancelled';
        const command = commandOf(request);
        const nonce = randomUUID().slice(0, 8);
        let cardMsgId;
        try {
            cardMsgId = await this.sendApprovalRequest(record, request, command, nonce);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`im-tuitui: approval send failed key=${key}: ${msg}`);
            return 'unavailable'; // 无法呈现审批，fail-closed
        }
        return new Promise((resolve) => {
            const entry = {
                record,
                request,
                resolve,
                nonce,
                ...(cardMsgId ? { cardMsgId } : {}),
            };
            if (request.signal) {
                const onAbort = () => {
                    if (this.pending.get(key) !== entry)
                        return;
                    this.pending.delete(key);
                    entry.resolve('cancelled');
                    this.updateResolvedCard(entry, 'cancelled', entry.cardMsgId);
                };
                entry.onAbort = onAbort;
                request.signal.addEventListener('abort', onAbort, { once: true });
            }
            this.pending.set(key, entry);
            this.logger.info(`im-tuitui: approval sent to tuitui, waiting for decision key=${key}`);
        });
    }
    /**
     * 发送审批请求：卡片优先，卡片失败/被关闭时退回纯文本编号提示。
     *
     * 返回卡片 msgid（有的话）——文本作答时要把同一张卡片改成结果态，否则旧按钮
     * 还能被继续点击。
     */
    async sendApprovalRequest(record, request, command, nonce) {
        if (this.cardsEnabled()) {
            try {
                const result = await this.sender.sendInteractive(record.replyTarget, buildApprovalCard(request, command, { nonce, theme: this.theme() }));
                return result.msgId;
            }
            catch (err) {
                this.logger.warn(`im-tuitui: approval card send failed, fallback to text: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        await this.sender.sendMarkdown(record.replyTarget, buildApprovalText(request, command, false));
        return undefined;
    }
    /** 结算后把卡片改成结果态（同步路径用，失败不打扰用户） */
    updateResolvedCard(entry, resolution, msgId) {
        void this.updateResolvedCardAsync(entry, resolution, msgId).catch(() => undefined);
    }
    async updateResolvedCardAsync(entry, resolution, msgId) {
        if (!msgId || !this.cardsEnabled())
            return;
        try {
            await this.sender.modifyInteractive(entry.record.replyTarget, msgId, buildApprovalResolvedCard(entry.request, commandOf(entry.request), resolution, this.theme()));
        }
        catch (err) {
            // 卡片改写失败不影响审批结果已经 settle，只影响观感
            this.logger.warn(`im-tuitui: approval card update failed key=${entry.record.sessionKey}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /**
     * 点击者白名单校验。
     *
     * 上游只校验一个 openid；推推同时有域账号与 uid，名单里两种写法都可能出现，
     * 任一命中即放行。身份完全缺失时 fail-closed。
     */
    isClickerAllowed(clicker) {
        if (this.config.access.c2cMode !== 'allowlist')
            return true;
        const ids = [clicker.account, clicker.uid].filter((id) => typeof id === 'string' && id.length > 0);
        if (ids.length === 0)
            return false;
        return ids.some((id) => this.config.access.c2cAllow.includes(id));
    }
    cardsEnabled() {
        return this.config.interactive?.enabled !== false;
    }
    theme() {
        return this.config.interactive;
    }
    removeAbort(entry) {
        if (entry.onAbort && entry.request.signal) {
            entry.request.signal.removeEventListener('abort', entry.onAbort);
        }
    }
}
//# sourceMappingURL=approval-channel.js.map
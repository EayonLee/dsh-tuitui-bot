import { extractMessageId, describeApiError } from "./client.js";
import { mergeMentions } from "./mention-parse.js";
import { resolveTuituiEmoji } from "./emoji.js";
import { settleReceipt } from "../features/receipt-registry.js";
/**
 * 发送重试。
 *
 * 推推的群聊发送偶尔会返回 `errcode 10503`（"消息发送失败"，多数是服务端瞬时故障
 * 或群里一瞬间发太密），换个时间点再发往往就成功了。以前这里直接抛错，结果就是
 * 模型答完了、用户一个字没看到，而日志里只有一条 warn —— 线上真的丢了 40 多条。
 */
const RETRYABLE_ERRCODES = new Set([10503]);
const RETRY_DELAYS_MS = [600, 1800];
function isRetryableSendError(error) {
    if (typeof error !== 'object' || error === null)
        return false;
    const record = error;
    const errcode = record.errcode;
    if (typeof errcode === 'number' && RETRYABLE_ERRCODES.has(errcode))
        return true;
    const status = record.status;
    if (typeof status === 'number' && status >= 500)
        return true;
    const message = typeof record.message === 'string' ? record.message : '';
    return /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network error/i.test(message);
}
function sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}
/**
 * ReplyTarget → SDK ToTarget。
 *
 * c2c 优先用域账号（SDK 的 account 目标支持编辑/撤回；uid 目标不支持），
 * 没有域账号才退化到 uid——此时 openStream 会返回 null，走静态发送。
 */
export function toSdkTarget(target) {
    if (target.scope === 'group') {
        return { groupId: target.targetId };
    }
    if (target.scope === 'c2c') {
        const account = target.targetId;
        if (/^\d+$/.test(account))
            return { uids: [account] };
        return { accounts: [account] };
    }
    // post 作用域没有 im 目标，必须走 teams
    return null;
}
/** 帖子目标是否完整 */
function isPostTarget(target) {
    return (target.scope === 'post' &&
        typeof target.teamId === 'string' &&
        target.teamId.length > 0 &&
        typeof target.channelId === 'string' &&
        target.channelId.length > 0);
}
/** 把媒体来源归一化为 SDK 可上传的形态 */
function normalizeMediaSource(source) {
    if (typeof source === 'string')
        return source;
    const bytes = source.data instanceof Uint8Array ? source.data : new Uint8Array(source.data);
    return {
        data: bytes,
        filename: source.filename,
        ...(source.contentType ? { contentType: source.contentType } : {}),
    };
}
/** 交互卡片的纯文本兜底渲染（帖子/卡片不可用时的降级） */
export function renderCardAsText(card) {
    const lines = [];
    if (card.head?.text)
        lines.push(`**${card.head.text}**`);
    if (card.body?.title)
        lines.push(`**${card.body.title}**`);
    if (card.body?.content)
        lines.push(card.body.content);
    for (const field of card.fields ?? []) {
        if (field.text)
            lines.push(field.text);
        else if (field.name && typeof field.value === 'string')
            lines.push(`${field.name}：${field.value}`);
    }
    for (const footer of card.footer ?? []) {
        if (footer.text)
            lines.push(footer.text);
    }
    const actions = (card.action ?? []).filter((action) => action.text);
    if (actions.length > 0) {
        lines.push('', actions.map((action, index) => `${index + 1}. ${action.text}`).join('\n'));
    }
    return lines.join('\n');
}
export class TuituiSenderImpl {
    client;
    logger;
    streaming;
    streamIntervalMs;
    retryDelaysMs;
    constructor(options) {
        this.client = options.client;
        this.logger = options.logger;
        this.streaming = options.streaming;
        this.streamIntervalMs = options.streamIntervalMs;
        this.retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
    }
    /**
     * 可重试的发送：临时故障重试，别把已经生成好的回复直接扔掉。
     * 只重试"明显是瞬时"的错误，参数/权限类错误重试也是白搭。
     */
    async withRetry(target, run) {
        let lastError;
        for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt += 1) {
            try {
                return await run();
            }
            catch (error) {
                lastError = error;
                const delay = this.retryDelaysMs[attempt];
                if (delay === undefined || !isRetryableSendError(error))
                    break;
                this.logger.warn(`send retry ${attempt + 1}/${this.retryDelaysMs.length} in ${delay}ms (scope=${target.scope} target=${target.targetId}): ${describeApiError(error)}`);
                await sleep(delay);
            }
        }
        throw lastError;
    }
    /** 统一失败日志（推推错误必须完整记录，含 trans_id） */
    warnFailure(action, target, error) {
        this.logger.warn(`${action} failed (scope=${target.scope} target=${target.targetId}): ${describeApiError(error)}`);
    }
    async sendMarkdown(target, content, opts) {
        if (!content.trim())
            return {};
        try {
            if (target.scope === 'post') {
                if (!isPostTarget(target))
                    throw new Error('post target requires teamId/channelId');
                const response = await this.withRetry(target, () => this.client.teams.sendPost({
                    teamId: target.teamId,
                    channelId: target.channelId,
                    text: content,
                    ...(target.parentPostId ? { parentId: target.parentPostId } : {}),
                }));
                return { msgId: extractMessageId(response) };
            }
            const to = toSdkTarget(target);
            if (!to)
                throw new Error(`unsupported target scope: ${target.scope}`);
            // 正文里写了 @某某 只算文字，推推要靠 at 元数据才算「真 @」：
            // 不带上 at，对方收不到通知，别的机器人更是完全看不见。
            const mentions = mergeMentions(opts?.at, content);
            const response = await this.withRetry(target, () => this.client.im.sendText({
                to,
                text: content,
                ...(target.msgId ? { referenceMessageId: target.msgId } : {}),
                ...(mentions.length > 0 ? { at: mentions } : {}),
            }));
            // 回复真的发出去了，才把「在算」换成「好了」
            void settleReceipt(target, 'done', target.msgId);
            return { msgId: extractMessageId(response) };
        }
        catch (error) {
            this.warnFailure('sendMarkdown', target, error);
            void settleReceipt(target, 'fail', target.msgId);
            throw error;
        }
    }
    openStream(target) {
        if (!this.streaming)
            return null;
        if (target.scope === 'c2c' && /^\d+$/.test(target.targetId)) {
            // uid 目标不支持 modifyText，降级静态发送
            return null;
        }
        if (target.scope === 'post' && !isPostTarget(target))
            return null;
        return new TuituiStreamSession(this, target, this.streamIntervalMs);
    }
    /** 首条发送（流式会话内部使用）：拿到 msgid 才能原地编辑 */
    async sendStreamSeed(target, content) {
        const result = await this.sendMarkdown(target, content);
        return result.msgId;
    }
    /** 原地编辑（流式会话内部使用） */
    async editStream(target, msgId, content, withoutPush) {
        if (!content.trim())
            return;
        try {
            if (target.scope === 'post') {
                await this.client.teams.editPost({
                    teamId: target.teamId,
                    channelId: target.channelId,
                    postId: msgId,
                    text: content,
                });
                return;
            }
            const to = toSdkTarget(target);
            if (!to)
                throw new Error(`unsupported target scope: ${target.scope}`);
            await this.client.im.modifyText({ to, messageId: msgId, text: content, withoutPush });
        }
        catch (error) {
            this.warnFailure('modifyText', target, error);
            throw error;
        }
    }
    async sendInteractive(target, card) {
        const interactive = card;
        if (target.scope === 'post') {
            // 帖子不支持交互卡片，降级为文本（保留编号选项语义，由 answer-parser 处理）
            return this.sendMarkdown(target, renderCardAsText(interactive));
        }
        try {
            const to = toSdkTarget(target);
            if (!to)
                throw new Error(`unsupported target scope: ${target.scope}`);
            const response = await this.client.im.sendInteractive({ to, interactive });
            return { msgId: extractMessageId(response) };
        }
        catch (error) {
            this.warnFailure('sendInteractive', target, error);
            throw error;
        }
    }
    async modifyInteractive(target, msgId, card) {
        const interactive = card;
        try {
            if (target.scope === 'post') {
                await this.client.teams.editPost({
                    teamId: target.teamId,
                    channelId: target.channelId,
                    postId: msgId,
                    text: renderCardAsText(interactive),
                });
                return;
            }
            const to = toSdkTarget(target);
            if (!to)
                throw new Error(`unsupported target scope: ${target.scope}`);
            await this.client.im.modifyInteractive({ to, messageId: msgId, interactive });
        }
        catch (error) {
            this.warnFailure('modifyInteractive', target, error);
            throw error;
        }
    }
    async sendImage(target, source, opts) {
        return this.sendMedia(target, source, { ...opts, kind: 'image' });
    }
    async sendFile(target, source, opts) {
        return this.sendMedia(target, source, { ...opts, kind: 'file' });
    }
    /**
     * 统一媒体发送。
     *
     * 推推没有独立的图片/视频/语音接口：im.sendFile 会按文件内容判定
     * image / attachment，图文说明用"先发说明文本、再发文件"两步（帖子用
     * teams.sendFile 自带 text 字段）。
     */
    async sendMedia(target, source, opts) {
        const prepared = normalizeMediaSource(source);
        try {
            if (target.scope === 'post') {
                if (!isPostTarget(target))
                    throw new Error('post target requires teamId/channelId');
                const response = await this.client.teams.sendFile({
                    teamId: target.teamId,
                    channelId: target.channelId,
                    source: prepared,
                    ...(opts.caption ? { text: opts.caption } : {}),
                    ...(target.parentPostId ? { parentId: target.parentPostId } : {}),
                });
                return { msgId: extractMessageId(response) };
            }
            const to = toSdkTarget(target);
            if (!to)
                throw new Error(`unsupported target scope: ${target.scope}`);
            if (opts.caption) {
                await this.client.im.sendText({ to, text: opts.caption });
            }
            const response = await this.client.im.sendFile({
                to,
                source: prepared,
                ...(opts.filename ? { filename: opts.filename } : {}),
            });
            return { msgId: extractMessageId(response) };
        }
        catch (error) {
            this.warnFailure(`sendMedia(${opts.kind})`, target, error);
            throw error;
        }
    }
    async recall(target, msgId) {
        if (target.scope === 'post') {
            // 团队帖子无撤回 API，静默跳过（记一次 debug 便于观测）
            this.logger.debug?.(`recall unsupported for post target (postId=${msgId})`);
            return;
        }
        try {
            const to = toSdkTarget(target);
            if (!to)
                return;
            await this.client.im.recall({ to, messageId: msgId });
        }
        catch (error) {
            this.warnFailure('recall', target, error);
            throw error;
        }
    }
    async emojiReaction(target, msgId, emoji, cancel) {
        // 推推只认表情名（微笑 / OK / 抱拳），unicode emoji 会被服务端拒成
        // 「不合法的emoji表情」；老配置里的 👀/✅ 在这里兜底翻译。
        const name = resolveTuituiEmoji(emoji);
        if (name === '')
            return;
        if (name === null) {
            this.logger.warn?.(`emojiReaction 跳过：推推不认这个表情 ${emoji}，请换成表情名（微笑 / OK / 抱拳 / 玫瑰）`);
            return;
        }
        emoji = name;
        try {
            if (target.scope === 'post') {
                await this.client.teams.emojiReaction({
                    teamId: target.teamId,
                    channelId: target.channelId,
                    postId: msgId,
                    emoji,
                    ...(cancel ? { cancel } : {}),
                });
                return;
            }
            const to = toSdkTarget(target);
            if (!to)
                return;
            await this.client.im.emojiReaction({ to, messageId: msgId, emoji, ...(cancel ? { cancel } : {}) });
        }
        catch (error) {
            // 回执失败不打断主流程，但必须留痕：以前这里用 debug，日志级别 info 起
            // 记，结果"表情回执完全没效果"在日志里一个字都查不到。
            this.logger.warn?.(`emojiReaction failed: ${describeApiError(error)} (emoji=${emoji})`);
        }
    }
}
/**
 * 流式会话：首帧发送拿 msgid，后续帧 modifyText(without_push) 原地刷新。
 *
 * 推推必须先发一条真实消息才有 msgid，因此首帧承担"建消息"的职责；
 * 拿不到 msgid（uid 目标/帖子返回缺失）时退化为每帧追加发送，保证不丢内容。
 */
class TuituiStreamSession {
    owner;
    target;
    throttleMs;
    msgId;
    pending = '';
    lastFlushAt = 0;
    flushing = null;
    closed = false;
    /** 无 msgid 降级模式下已经发出去的内容，用来只发增量、避免重复整段 */
    degradedSent = '';
    constructor(owner, target, throttleMs) {
        this.owner = owner;
        this.target = target;
        this.throttleMs = Math.max(0, throttleMs);
    }
    async update(content) {
        if (this.closed)
            return;
        this.pending = content;
        const now = Date.now();
        if (this.msgId === undefined) {
            if (this.degradedSent === '') {
                // 首帧立即发送（用户等待感知最关键）
                this.msgId = await this.owner.sendStreamSeed(this.target, content);
                this.lastFlushAt = now;
                if (this.msgId === undefined)
                    this.degradedSent = content;
                return;
            }
            // 已确定拿不到 msgid：后续帧按增量发，不要每帧重复整段
            if (now - this.lastFlushAt < this.throttleMs)
                return;
            await this.flushDegraded();
            this.lastFlushAt = now;
            return;
        }
        if (now - this.lastFlushAt < this.throttleMs) {
            // 节流窗口内：留给 complete() 或下一个窗口统一刷新
            return;
        }
        await this.flush();
    }
    async complete() {
        if (this.closed)
            return;
        this.closed = true;
        if (this.msgId === undefined) {
            await this.flushDegraded();
            return;
        }
        await this.flush();
    }
    /**
     * 无 msgid 的降级发送：只发「还没发过的增量」。
     *
     * 之前这里直接发 pending，而 update() 已经用 pending 发过（msgid 缺失时每帧
     * 都要重建消息），于是用户看到最后一段内容重复一遍。改成按前缀做增量：
     * 内容不是上一版的延续（新 attempt 重置）时才发整段。
     */
    async flushDegraded() {
        const content = this.pending;
        if (!content || content === this.degradedSent)
            return;
        const delta = content.startsWith(this.degradedSent)
            ? content.slice(this.degradedSent.length)
            : content;
        if (!delta)
            return;
        this.degradedSent = content;
        await this.owner.sendStreamSeed(this.target, delta);
    }
    async flush() {
        if (this.flushing) {
            await this.flushing;
            return;
        }
        const content = this.pending;
        const msgId = this.msgId;
        if (!msgId || !content)
            return;
        this.lastFlushAt = Date.now();
        this.flushing = this.owner
            .editStream(this.target, msgId, content, true)
            .catch(() => undefined)
            .then(() => {
            this.flushing = null;
        });
        await this.flushing;
    }
}
//# sourceMappingURL=sender.js.map
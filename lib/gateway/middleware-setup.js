import { getHistoryStore, getJudgeHistoryStore, historyGroupKey } from "../features/history-store.js";
import { judgeShouldJoin } from "../features/smart-judge.js";
import { getScopePeer, resolveScopeStrategy } from "../shared/index.js";
import { MiddlewareKernel, errorHandler, messageFilter, accessPolicy, historyBuffer, mentionGate, contentSanitizer, rateLimiter, slashCommand, questionAnswer, concurrencyGuard, receiptReactions, quoteRef, attachmentProcessor, envelopeFormatter, } from "./middleware/index.js";
/** 群聊/帖子的历史键（与 historyBuffer 的 groupKey 同源） */
function probeHistoryKey(ctx, config) {
    const message = ctx.message;
    if (message.kind === 'group' && message.groupId !== undefined && message.groupId !== '') {
        return historyGroupKey(config.appId, message.groupId);
    }
    if (message.kind === 'post' && message.post !== undefined) {
        return historyGroupKey(config.appId, message.post.teamId + '/' + message.post.channelId);
    }
    return undefined;
}
/**
 * smart 模式的插话判定：把上下文交给模型，让它自己决定。
 *
 * 没有名字匹配、没有「刚聊过就接话」这类规则——那跟人格设定打架。模型不可用
 * 或判定失败就沉默（fail-closed），冷却由 smart-judge 内部按会话键控制，成本可控。
 */
async function smartReplyProbe(ctx, config, deps, logger) {
    const message = ctx.message;
    // 每一条判定都留一行（info 级）：为什么回、为什么不回，事后能查。
    // 以前只在 debug 下打，出了「明明该回却没回」根本无从下手。
    const scopePeer = getScopePeer(message);
    const who = scopePeer.scope + ':' + scopePeer.peerId;
    const text = message.content.replace(/\s+/g, ' ').slice(0, 40);
    const say = (join, why, extra = '') => {
        logger.info(`[tuitui/smart] ${who} join=${join} why=${why} text="${text}"${extra}`);
        return join;
    };
    if (deps === undefined)
        return say(false, 'no-judge-deps', ' hint=llm服务未注入');
    const route = deps.resolveRoute(ctx);
    if (route === undefined)
        return say(false, 'no-route', ' hint=该会话没有可用模型');
    const key = probeHistoryKey(ctx, config);
    // 用「只加不删」的判定历史：普通历史回复后会被清空，用它判断瞎子摸象
    const recent = key === undefined ? [] : getJudgeHistoryStore().list(key, deps.settings.maxHistory);
    const history = recent.map((entry) => ({
        sender: entry.senderName === undefined || entry.senderName === '' ? entry.senderId : entry.senderName,
        text: entry.content,
        self: entry.senderId === config.appId,
    }));
    const startedAt = Date.now();
    const verdict = await judgeShouldJoin({
        llm: deps.llm,
        route,
        history,
        message: {
            sender: message.senderName === undefined || message.senderName === '' ? message.senderId : message.senderName,
            text: message.content,
        },
        prompt: deps.settings.prompt,
        timeoutMs: deps.settings.timeoutMs,
        maxTokens: deps.settings.maxTokens,
        ...(key === undefined ? {} : { cooldownKey: key }),
        cooldownMs: deps.settings.cooldownMs,
        logger,
    });
    // 挂个表情也算回话：比发文字轻，也不会刷屏
    if (verdict.act === 'emoji' && verdict.emoji !== undefined && verdict.emoji !== '') {
        const msgId = ctx.replyTarget.msgId;
        if (msgId !== undefined && msgId !== '') {
            void ctx.bot
                .emojiReaction(ctx.replyTarget, msgId, verdict.emoji)
                .catch((err) => {
                logger.debug('[tuitui/smart] 表情回复失败: ' + (err instanceof Error ? err.message : String(err)));
            });
            return say(false, 'emoji:' + verdict.emoji, ` model=${route.provider}/${route.model} ${Date.now() - startedAt}ms`);
        }
    }
    const elapsedMs = Date.now() - startedAt;
    return say(verdict.join, verdict.reason ?? (verdict.join ? 'model-yes' : 'model-no'), ` model=${route.provider}/${route.model} history=${history.length} ${elapsedMs}ms`);
}
/** 组装中间件链（顺序与上游逐条对应，见函数体注释编号） */
export function setupMiddlewares(options) {
    const { config, manager, logger, commands, smartJudge } = options;
    // 内核自带的兜底日志用注入的 logger，避免异常只落到 console
    const kernel = new MiddlewareKernel(logger);
    // 1. 错误兜底（最外层洋葱皮）
    kernel.use(errorHandler(logger));
    // 2. 消息过滤：bot 回声 + 消息去重
    kernel.use(messageFilter({ skipSelfEcho: false }));
    // 3. 访问控制（空名单 = 拒绝所有人，fail-closed）
    kernel.use(accessPolicy({
        c2c: { mode: config.access.c2cMode, allow: config.access.c2cAllow, deny: config.access.c2cBlock },
        group: { mode: config.access.groupMode, allow: config.access.groupAllow, deny: config.access.groupBlock },
        post: { mode: config.access.postMode, allow: config.access.postAllow, deny: config.access.postBlock },
        onBlock: (mctx, reason) => {
            const { scope, peerId } = getScopePeer(mctx.message);
            logger.info(`[tuitui/access] ${scope}:${peerId} blocked=${reason}`);
        },
    }));
    // 4. 群/帖子历史缓冲 — 放在门控之前，确保所有消息（含未 @bot）都计入上下文
    kernel.use(historyBuffer({
        limit: config.historyLimit,
        store: getHistoryStore(),
        // 判定另存一份永不清理的镜像：普通历史回复后就清空了，
        // 判定拿那份当上下文，等于每轮只看得到上一条消息。
        mirrorStore: getJudgeHistoryStore(),
        recordOnSkip: true,
        groupKey: (ctx) => {
            if (ctx.message.kind === 'group' && ctx.message.groupId) {
                return historyGroupKey(config.appId, ctx.message.groupId);
            }
            if (ctx.message.kind === 'post' && ctx.message.post) {
                return historyGroupKey(config.appId, `${ctx.message.post.teamId}/${ctx.message.post.channelId}`);
            }
            return undefined;
        },
    }));
    // 5. 群聊/帖子触发门控（require=仅@ / always=全部 / smart=仅相关）
    kernel.use(mentionGate({
        requireMentionInGroup: config.requireMention,
        requireMentionInPost: config.requireMentionInPost,
        ...(config.mentionPolicy !== undefined ? { policy: config.mentionPolicy } : {}),
        isSmartReply: (ctx) => smartReplyProbe(ctx, config, smartJudge, logger),
    }));
    // 6. 内容清洗（去 @marker、表情标签、多余空白）
    kernel.use(contentSanitizer({ parseFaceTags: true }));
    // 7. 三层限流（sender / group / global）
    kernel.use(rateLimiter());
    // 8. 斜杠命令（在 concurrencyGuard 之前，命令匹配后不排队直接响应）
    //    关闭 autoHelp：help 由插件注册为 /bot-help，避免 SDK 再自动注册一个 /help
    kernel.use(slashCommand({ autoHelp: false, commands }));
    // 8.5 待答问题截获（在 concurrencyGuard 之前，答案消息不排队直接作答）
    kernel.use(questionAnswer(manager));
    // 9. 并发串行 + 消息合并（同 peer 排队，避免 session 冲突）
    kernel.use(concurrencyGuard({
        // 群聊排队一条条来，私聊直接打断——按作用域分开配
        strategyFor: (mctx) => resolveScopeStrategy(config, mctx.message.kind),
        maxQueue: config.maxQueue,
        maxProcessingMs: config.processingTimeoutMs,
        // 超时中断：光停中间件链不够，正在飞的模型调用/工具执行必须真正取消，
        // 否则锁虽然放了，token 还在烧、出站流会继续往同一个 msgid 写。
        onInterrupt: (ctx, reason) => {
            const { scope, peerId } = getScopePeer(ctx.message);
            const record = manager.getSessionRecord(scope, peerId);
            if (record?.agent.status === 'running') {
                record.agent.cancel({ kind: 'user' });
                logger.warn(`[concurrency] 处理超时(${reason})，已取消 scope=${scope} peer=${peerId} 的在飞生成`);
            }
        },
        logger,
    }));
    // 10. 表情回执：先挂「在算」，处理完换「好了」，出错换「不太对」
    kernel.use(receiptReactions({
        enabled: config.reactions.enabled,
        inGroup: config.reactions.inGroup,
        ack: config.reactions.ack,
        done: config.reactions.done,
        fail: config.reactions.fail,
        logger,
    }));
    // 11. 引用消息解析（记录 + 解析被引用原文）
    kernel.use(quoteRef({ maxSize: 500, preferMsgElements: true }));
    // 11.5 附件下载（媒体落盘到 PLUGIN_HOME/media，供 @提及 / 工具访问）
    kernel.use(attachmentProcessor(config, logger));
    // 12. 上下文组装（把 history + quote + sender 组成 envelope）
    kernel.use(envelopeFormatter({
        historyLimit: config.historyLimit,
        includeQuote: true,
        includeSender: true,
    }));
    return kernel;
}
//# sourceMappingURL=middleware-setup.js.map
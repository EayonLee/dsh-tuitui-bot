import { getHistoryStore, historyGroupKey } from "../features/history-store.js";
import { isLikelyFollowUp } from "../features/followup-store.js";
import { judgeShouldJoin } from "../features/smart-judge.js";
import { getScopePeer } from "../shared/index.js";
import { MiddlewareKernel, errorHandler, messageFilter, accessPolicy, historyBuffer, mentionGate, contentSanitizer, rateLimiter, slashCommand, questionAnswer, concurrencyGuard, typingIndicator, quoteRef, attachmentProcessor, envelopeFormatter, } from "./middleware/index.js";
/**
 * smart 模式下的确定性规则（模型不可用时的降级路径）。
 *
 * 注意：这些规则不再决定「要不要回」，只是模型判定不可用时的最低保障：
 *   1. 文本里出现机器人别名（config.botAliases，例如「憨包」）；
 *   2. 追问窗口：机器人刚在该会话回过这个人（smartFollowUpMs）。
 */
function smartRuleFallback(ctx, config) {
    const message = ctx.message;
    // 规则 2：别名命中（忽略大小写，避免「Bot」「bot」两种写法）
    const aliases = config.botAliases.filter((alias) => alias.trim() !== '');
    if (aliases.length > 0) {
        const text = (message.content ?? '').toLowerCase();
        if (text !== '' && aliases.some((alias) => text.includes(alias.trim().toLowerCase()))) {
            return true;
        }
    }
    // 规则 2：追问窗口（同一个人、刚聊过）
    const { scope, peerId } = getScopePeer(message);
    return isLikelyFollowUp(scope, peerId, message.senderId, config.smartFollowUpMs);
}
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
 * 模型/路线不可用或判定失败 → 回落到确定性规则（宁可多回一句，也别在不该沉默
 * 的时候沉默）。冷却由 smart-judge 内部按会话键控制，成本可控。
 */
async function smartReplyProbe(ctx, config, deps, logger) {
    const message = ctx.message;
    const fallback = smartRuleFallback(ctx, config);
    if (deps === undefined || !deps.settings.enabled)
        return fallback;
    const route = deps.resolveRoute(ctx);
    if (route === undefined)
        return fallback;
    const key = probeHistoryKey(ctx, config);
    const recent = key === undefined ? [] : getHistoryStore().list(key, deps.settings.maxHistory);
    const history = recent.map((entry) => ({
        sender: entry.senderName === undefined || entry.senderName === '' ? entry.senderId : entry.senderName,
        text: entry.content,
        self: entry.senderId === config.appId,
    }));
    const verdict = await judgeShouldJoin({
        llm: deps.llm,
        route,
        botName: deps.botName,
        aliases: config.botAliases,
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
    if (config.debug) {
        logger.debug('[smart-judge] join=' + String(verdict.join) + ' reason=' + String(verdict.reason));
    }
    return verdict.join;
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
        onBlock: (_ctx, reason) => {
            if (config.debug)
                logger.debug(`Access blocked: ${reason}`);
        },
    }));
    // 4. 群/帖子历史缓冲 — 放在门控之前，确保所有消息（含未 @bot）都计入上下文
    kernel.use(historyBuffer({
        limit: config.historyLimit,
        store: getHistoryStore(),
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
        strategy: 'merge',
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
    // 10. 单聊输入状态指示（推推用 emoji reaction 作为收消息回执）
    kernel.use(typingIndicator());
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
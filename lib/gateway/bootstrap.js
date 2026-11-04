import { SessionManager } from "../session/index.js";
import { handleInbound, createOutboundHandler } from "../transport/index.js";
import { parseStreamFrame } from "../transport/events.js";
import { cacheMsgId } from "../transport/msgid-cache.js";
import { DeliverablesDeliverer } from "../transport/deliverables.js";
import { QuestionChannel } from "../features/question-channel.js";
import { ApprovalChannel } from "../features/approval-channel.js";
import { decodeButtonData, getInteractiveAction } from "../features/button-utils.js";
import { buildCommandList } from "../commands/index.js";
import { startMediaCleanup } from "../media/media-cleaner.js";
import { ensureVisionInputModal, registerDescribeImageTool } from "../media/vision-tool.js";
import { registerSendFileTool } from "../media/send-file-tool.js";
import { createTuituiClient, normalizeEvent, TuituiSenderImpl, describeApiError, DEFAULT_SHORTCUTS, syncShortcutCommands, createAgentStepReporter } from "../tuitui/index.js";
import { setupMiddlewares } from "./middleware-setup.js";
import { getScopePeer } from "../shared/index.js";
/** 从归一化消息推导出站目标 */
export function buildReplyTarget(message) {
    if (message.kind === 'group') {
        const groupId = message.groupId ?? message.senderId;
        return { scope: 'group', targetId: groupId, msgId: message.messageId };
    }
    if (message.kind === 'post' && message.post) {
        const { teamId, channelId, postId, parentId } = message.post;
        return {
            scope: 'post',
            targetId: channelId,
            channelId,
            teamId,
            postId,
            // 回复入同一讨论串：有父帖则挂父帖，否则挂本条帖子
            parentPostId: parentId ?? postId,
            msgId: postId,
        };
    }
    // 单聊：优先域账号（可编辑/撤回），无域账号才退化到 uid
    const targetId = message.senderAccount || message.senderId;
    return { scope: 'c2c', targetId, msgId: message.messageId };
}
/** 构造中间件上下文（skip 语义：中断后续中间件与入站处理） */
function createMiddlewareContext(message, replyTarget, bot) {
    let skipped;
    return {
        message,
        state: {},
        replyTarget,
        bot,
        skip(reason) {
            skipped = reason;
        },
        get skipped() {
            return skipped;
        },
    };
}
/** 交互按钮路由：按卡片 value 的 `t` 判别字段分发 */
async function dispatchInteraction(payload, questionChannel, approvalChannel, logger) {
    const [question, approval] = await Promise.all([
        questionChannel.handleInteraction(payload).catch(() => false),
        approvalChannel.handleInteraction(payload).catch(() => false),
    ]);
    if (question || approval)
        return true;
    // 是本插件协议里的按钮，却没人认领 = 卡片过期（审批/问答早就结束，或插件重启过）。
    // 静默是这里最差的选项：用户只看到"点了没反应"，然后是会话一直在等。
    const click = getInteractiveAction(payload.message);
    const button = click ? decodeButtonData(click.value) : undefined;
    if (!button)
        return false;
    try {
        await payload.bot.sendMarkdown(payload.replyTarget, '这张卡片已经作废了（审批/问题已经结束，或者机器人刚刚重启过）。要办就重新发一次。');
    }
    catch (error) {
        logger.warn(`stale-card notice failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return false;
}
/**
 * 跑一个"有就有、没有也能聊"的可选注册项：失败只记 warn，不影响插件激活。
 *
 * 历史上这里有过一次整插件激活失败（可选服务读取抛错带崩 apply），
 * 结果是通道静默死掉、卡片全是死的，所以这些点必须各自兜住。
 */
function runOptional(logger, label, fn) {
    try {
        fn();
    }
    catch (error) {
        logger.warn(`${label} registration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * 安全读取宿主服务。
 *
 * cordis 的 ctx 是代理：访问未在 `inject` 里声明的服务会抛错，而不是返回 undefined。
 * 可选依赖（比如智能判定要用的 llm）一律走这里，读不到就当没有。
 */
function readContextService(ctx, name) {
    try {
        const target = ctx;
        return typeof target.get === 'function' ? target.get(name) : undefined;
    }
    catch {
        return undefined;
    }
}
export async function bootstrapGateway(ctx, agents, config, logger) {
    const manager = new SessionManager(ctx, agents, config, logger);
    // ── 推推客户端 ──
    const client = createTuituiClient(config, logger);
    // ── 出站发送器（全插件唯一发消息入口） ──
    const sender = new TuituiSenderImpl({
        client,
        logger,
        streaming: config.streaming,
        streamIntervalMs: config.streamIntervalMs,
        textChunkLimit: config.textChunkLimit,
    });
    // ── 中间件链 ──
    const commands = buildCommandList({ manager, config, logger });
    // 智能判定到底接上没有：没有就不会有任何插嘴，事后查日志第一件事就是看这行
    const llmService = readContextService(ctx, 'llm');
    if (config.mentionPolicy === 'smart') {
        logger.info('[tuitui/smart] judge wired: llm=' + (llmService === undefined ? 'MISSING' : 'ok')
            + ' maxHistory=' + String(config.smartJudge.maxHistory)
            + ' cooldownMs=' + String(config.smartJudge.cooldownMs)
            + ' prompt=' + (config.smartJudge.prompt.trim() === '' ? '出厂' : '自定义'));
    }
    const kernel = setupMiddlewares({
        config,
        manager,
        logger,
        commands,
        // 智能插话：模型 + 该会话生效的模型路线 + 机器人自称
        smartJudge: {
            // 必须走 ctx.get：cordis 对未 inject 的服务直接抛「cannot get property」，
            // 拿不到就当没有（判定降级为规则），不能因此把整个插件启动搞挂
            llm: llmService,
            resolveRoute: (mctx) => {
                const { scope, peerId } = getScopePeer(mctx.message);
                return manager.getEffectiveModel(scope, peerId);
            },
            settings: config.smartJudge,
        },
    });
    // ── 问答 / 审批通道（交互卡片 + 文本兜底） ──
    const questionChannel = new QuestionChannel(manager, sender, config, logger);
    manager.questionChannel = questionChannel;
    // 可选服务（userQuestions / approval）挂载失败只降级对应通道，
    // 不能把整个插件激活搞挂——插件死了，连消息都收不到。
    try {
        questionChannel.install(ctx);
    }
    catch (error) {
        logger.warn(`question channel install failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const approvalChannel = new ApprovalChannel(manager, sender, config, logger);
    manager.approvalChannel = approvalChannel;
    try {
        approvalChannel.install(ctx);
    }
    catch (error) {
        logger.warn(`approval channel install failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    // ── 入站：事件 → 归一化 → 中间件 → dsh agent ──
    const handleEvent = async (body) => {
        const message = normalizeEvent(body, {
            render: (data) => client.event.renderMessageBody(data),
        });
        if (!message) {
            if (config.debug)
                logger.debug(`ignored event: ${String(body.event)}`);
            return;
        }
        const replyTarget = buildReplyTarget(message);
        // 交互回调：不进中间件链（没有会话上下文），直接路由到通道
        if (message.eventType === 'interactive_action') {
            try {
                await dispatchInteraction({ message, replyTarget, bot: sender }, questionChannel, approvalChannel, logger);
            }
            catch (error) {
                logger.warn(`interaction dispatch failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            return;
        }
        // 记录最近 msgId，供无上下文的出站发送（文件发送显式 target、主动推送等）引用回复
        cacheMsgId(replyTarget.scope, replyTarget.targetId, message.messageId);
        const mwCtx = createMiddlewareContext(message, replyTarget, sender);
        try {
            await kernel.dispatch(mwCtx);
        }
        catch (error) {
            logger.error(`middleware chain failed: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        if (mwCtx.skipped)
            return;
        if (config.debug) {
            logger.debug(`← message (post-middleware): ${JSON.stringify(message).slice(0, 500)}`);
        }
        await handleInbound(mwCtx, manager, config, logger);
    };
    // ── 出站：dsh session/event → 推推消息 ──
    let toolsRegistry;
    try {
        toolsRegistry = ctx.get('tools');
    }
    catch {
        toolsRegistry = undefined;
    }
    const agentSteps = createAgentStepReporter(client, config, logger);
    // 交付物投递：present 声明的文件在轮末发送到当前会话
    const deliverablesDeliverer = new DeliverablesDeliverer(sender, sender, config, logger);
    const outbound = createOutboundHandler(manager, sender, config, logger, toolsRegistry, deliverablesDeliverer, agentSteps);
    ctx
        .on('session/event', outbound.routeSessionEvent);
    // ── 出站流式：agent/assistant-stream → 流式帧路由 ──
    // 该事件按 agent 作用域派发，根作用域监听器不带 global 会被过滤，
    // 帧到达后自行按 agent.id 路由，非本插件会话在 router 内忽略。
    ctx.on('agent/assistant-stream', (payload) => {
        const parsed = parseStreamFrame(payload);
        if (parsed !== undefined)
            outbound.routeStreamFrame(parsed.agentId, parsed.delta);
    }, { global: true });
    // ── 富媒体过期清理 ──
    if (config.media.enabled) {
        try {
            startMediaCleanup(ctx, config.media.ttlHours, logger);
        }
        catch (error) {
            logger.warn(`media cleanup start failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    // ── 视觉工具注册（tuitui_describe_image，复用 dsh llm + attachments） ──
    runOptional(logger, 'vision modal', () => ensureVisionInputModal(config.vision, logger));
    runOptional(logger, 'describe-image tool', () => registerDescribeImageTool(ctx, config.vision, logger));
    // ── 附件发送工具注册（tuitui_send_file） ──
    runOptional(logger, 'send-file tool', () => registerSendFileTool(ctx, sender, manager, config, logger));
    // ── 生命周期 ──
    ctx.effect(() => {
        logger.info(`Starting tuitui bot (appId=${config.appId})`);
        // 启动自检：拉一次机器人信息，顺带把日志里的身份打出来（失败不阻断启动）
        void client.property
            .info()
            .then((info) => logger.info(`tuitui bot ready: ${info.name} (${info.account})`))
            .catch((error) => logger.warn(`property.info failed: ${describeApiError(error)}`));
        // 快捷指令同步（推推客户端输入框的指令面板）
        void syncShortcutCommands(client, DEFAULT_SHORTCUTS, logger);
        const subscription = client.event.subscribe({
            onConnected: () => logger.info('tuitui websocket connected'),
            onEvent: (body) => handleEvent(body),
            onDisconnected: (reason) => logger.warn(`tuitui websocket disconnected (auto-reconnecting): ${reason instanceof Error ? reason.message : String(reason)}`),
            onError: (error) => logger.warn(`tuitui websocket error (auto-reconnecting): ${error instanceof Error ? error.message : String(error)}`),
        });
        return async () => {
            logger.info('Shutting down');
            subscription.unsubscribe();
            // 先结算挂起的审批/问答：宿主正在等这些 Promise，拖到进程没了就是永久悬挂
            approvalChannel.dispose();
            questionChannel.uninstall();
            await manager.disposeAll();
        };
    }, 'im-tuitui.lifecycle');
}
//# sourceMappingURL=bootstrap.js.map
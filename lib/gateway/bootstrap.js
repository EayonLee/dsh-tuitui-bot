import { SessionManager } from "../session/index.js";
import { handleInbound, createOutboundHandler } from "../transport/index.js";
import { parseStreamFrame } from "../transport/events.js";
import { cacheMsgId } from "../transport/msgid-cache.js";
import { DeliverablesDeliverer } from "../transport/deliverables.js";
import { QuestionChannel } from "../features/question-channel.js";
import { ApprovalChannel } from "../features/approval-channel.js";
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
async function dispatchInteraction(payload, questionChannel, approvalChannel) {
    const [question, approval] = await Promise.all([
        questionChannel.handleInteraction(payload).catch(() => false),
        approvalChannel.handleInteraction(payload).catch(() => false),
    ]);
    return question || approval;
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
    const kernel = setupMiddlewares({
        config,
        manager,
        logger,
        commands,
        // 智能插话：模型 + 该会话生效的模型路线 + 机器人自称
        smartJudge: {
            llm: ctx.llm,
            resolveRoute: (mctx) => {
                const { scope, peerId } = getScopePeer(mctx.message);
                return manager.getEffectiveModel(scope, peerId);
            },
            botName: config.botAliases[0] ?? '机器人',
            settings: config.smartJudge,
        },
    });
    // ── 问答 / 审批通道（交互卡片 + 文本兜底） ──
    const questionChannel = new QuestionChannel(manager, sender, config, logger);
    manager.questionChannel = questionChannel;
    questionChannel.install(ctx);
    const approvalChannel = new ApprovalChannel(manager, sender, config, logger);
    manager.approvalChannel = approvalChannel;
    approvalChannel.install(ctx);
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
                await dispatchInteraction({ message, replyTarget, bot: sender }, questionChannel, approvalChannel);
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
        startMediaCleanup(ctx, config.media.ttlHours, logger);
    }
    // ── 视觉工具注册（tuitui_describe_image，复用 dsh llm + attachments） ──
    ensureVisionInputModal(config.vision, logger);
    registerDescribeImageTool(ctx, config.vision, logger);
    // ── 附件发送工具注册（tuitui_send_file） ──
    registerSendFileTool(ctx, sender, manager, config, logger);
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
            await manager.disposeAll();
        };
    }, 'im-tuitui.lifecycle');
}
//# sourceMappingURL=bootstrap.js.map
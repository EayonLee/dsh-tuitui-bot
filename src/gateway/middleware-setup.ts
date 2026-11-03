/**
 * 中间件编排 — 与上游 dsh-qqbot 完全相同的顺序
 *
 * 上游这层依赖 @tencent-connect/qqbot-nodejs 内置的洋葱链；推推 SDK 没有中间件
 * 概念，因此由我们自己的 gateway/middleware 内核提供等价能力。顺序是行为契约：
 * 访问控制必须在历史缓冲之前（拒绝的消息不记账），@门控必须在历史缓冲之后
 * （未 @ 的消息也要进上下文），命令匹配必须早于并发串行（命令不排队）。
 */
import type { ImTuituiConfig } from '../config.ts';
import type { Logger, MiddlewareContext } from '../types.ts';
import type { SessionManager } from '../session/index.ts';
import type { CommandEntry } from '../commands/index.ts';
import { getHistoryStore, historyGroupKey } from '../features/history-store.ts';
import { isLikelyFollowUp } from '../features/followup-store.ts';
import { getScopePeer } from '../shared/index.ts';
import {
  MiddlewareKernel,
  errorHandler,
  messageFilter,
  accessPolicy,
  historyBuffer,
  mentionGate,
  contentSanitizer,
  rateLimiter,
  slashCommand,
  questionAnswer,
  concurrencyGuard,
  typingIndicator,
  quoteRef,
  attachmentProcessor,
  envelopeFormatter,
} from './middleware/index.ts';

export interface MiddlewareSetupOptions {
  config: ImTuituiConfig;
  manager: SessionManager;
  logger: Logger;
  /** 命令注册表（commands/buildCommandList 产物） */
  commands: CommandEntry[];
}

/**
 * smart 模式的「相关消息」判定。
 *
 * 三条确定性规则（不额外调用模型，避免每条群消息都烧 token）：
 *   1. 引用/回复了机器人：由 quote-ref 写下的 state 里带出（宿主 atMe 已覆盖直接 @）；
 *   2. 文本里出现机器人别名（config.botAliases，例如「憨包」）；
 *   3. 追问窗口：机器人刚在该会话回过这个人，且本条仍是他发的（smartFollowUpMs）。
 */
function smartReplyProbe(ctx: MiddlewareContext, config: ImTuituiConfig): boolean {
  const message = ctx.message;

  // 规则 2：别名命中（忽略大小写，避免「Bot」「bot」两种写法）
  const aliases = config.botAliases.filter((alias) => alias.trim() !== '');
  if (aliases.length > 0) {
    const text = (message.content ?? '').toLowerCase();
    if (text !== '' && aliases.some((alias) => text.includes(alias.trim().toLowerCase()))) {
      return true;
    }
  }

  // 规则 3：追问窗口（同一个人、刚聊过）
  const { scope, peerId } = getScopePeer(message);
  return isLikelyFollowUp(scope, peerId, message.senderId, config.smartFollowUpMs);
}

/** 组装中间件链（顺序与上游逐条对应，见函数体注释编号） */
export function setupMiddlewares(options: MiddlewareSetupOptions): MiddlewareKernel {
  const { config, manager, logger, commands } = options;
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
      if (config.debug) logger.debug(`Access blocked: ${reason}`);
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
    isSmartReply: (ctx) => smartReplyProbe(ctx, config),
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

/**
 * 中间件编排 — 洋葱链的装配与顺序
 *
 * 推推 SDK 只有裸事件回调，没有中间件概念，因此由 gateway/middleware 内核提供
 * 洋葱链能力。顺序是行为契约：
 * 访问控制必须在历史缓冲之前（拒绝的消息不记账），@门控必须在历史缓冲之后
 * （未 @ 的消息也要进上下文），命令匹配必须早于并发串行（命令不排队）。
 */
import type { ImTuituiConfig } from '../config.ts';
import type { Logger, MiddlewareContext } from '../types.ts';
import type { SessionManager } from '../session/index.ts';
import type { CommandEntry } from '../commands/index.ts';
import { getHistoryStore, historyGroupKey } from '../features/history-store.ts';
import { judgeShouldJoin, type JudgeLine } from '../features/smart-judge.ts';
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

/** 智能插话判定所需的外部依赖（模型 + 会话模型路线 + 判定参数） */
export interface SmartJudgeDeps {
  /** ctx.llm 服务（缺失即无法判定，此时一律沉默） */
  llm: unknown;
  /** 按消息解析生效的模型路线 */
  resolveRoute: (ctx: MiddlewareContext) => { provider: string; model: string } | undefined;
  /** 判定参数（来自 config.smartJudge） */
  settings: {
    maxHistory: number;
    maxTokens: number;
    timeoutMs: number;
    cooldownMs: number;
    /** 自定义判定提示词（空则用内置默认） */
    prompt: string;
  };
}

export interface MiddlewareSetupOptions {
  config: ImTuituiConfig;
  manager: SessionManager;
  logger: Logger;
  /** 命令注册表（commands/buildCommandList 产物） */
  commands: CommandEntry[];
  /** 智能插话判定依赖；不给则 smart 模式一律沉默 */
  smartJudge?: SmartJudgeDeps;
}

/** 群聊/帖子的历史键（与 historyBuffer 的 groupKey 同源） */
function probeHistoryKey(ctx: MiddlewareContext, config: ImTuituiConfig): string | undefined {
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
async function smartReplyProbe(
  ctx: MiddlewareContext,
  config: ImTuituiConfig,
  deps: SmartJudgeDeps | undefined,
  logger: Logger,
): Promise<boolean> {
  const message = ctx.message;
  if (deps === undefined) return false;

  const route = deps.resolveRoute(ctx);
  if (route === undefined) return false;

  const key = probeHistoryKey(ctx, config);
  const recent = key === undefined ? [] : getHistoryStore().list(key, deps.settings.maxHistory);
  const history: JudgeLine[] = recent.map((entry) => ({
    sender: entry.senderName === undefined || entry.senderName === '' ? entry.senderId : entry.senderName,
    text: entry.content,
    self: entry.senderId === config.appId,
  }));

  const verdict = await judgeShouldJoin({
    llm: deps.llm as { stream: (options: never) => AsyncIterable<never> } | undefined,
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

  if (config.debug) {
    logger.debug('[smart-judge] join=' + String(verdict.join) + ' reason=' + String(verdict.reason));
  }
  return verdict.join;
}

/** 组装中间件链（顺序与上游逐条对应，见函数体注释编号） */
export function setupMiddlewares(options: MiddlewareSetupOptions): MiddlewareKernel {
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

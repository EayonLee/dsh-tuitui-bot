/**
 * 斜杠命令中间件 — 匹配 `/cmd` 并交给注册表里的 handler 执行
 *
 * 命令由 W5 的 `commands/buildCommandList()` 统一声明，本中间件只负责
 * 「认出来 + 执行 + 消费掉」：命中即 `skip`，消息不会再流进会话（也就不排队、
 * 不消耗模型额度）——这正是命令必须放在 concurrencyGuard 之前的原因。
 *
 * 推推的原生「快捷指令」被点击后，客户端发回来的就是一条普通文本消息，其正文
 * 等于该指令登记的触发词。因此这里除了前缀匹配，还支持**无前缀的原生触发词**
 * 精确匹配（`triggers`）；前缀匹配与触发词匹配都走同一套 scope/权限检查。
 *
 * 与上游的两点差异（都是为了贴合推推与本次集成的契约）：
 *   1. 命令对象用 `CommandEntry`（name/aliases/handler/...），而不是上游的
 *      `SlashCommand`（name 可为数组、handler 返回待发送字符串）。推推侧命令
 *      自己用 `ctx.bot` 发送（长内容需要分片、卡片等），所以 handler 返回 void；
 *      同时保留上游「返回字符串即自动回复」的兼容路径。
 *   2. 工厂直接返回中间件（并挂上 register/unregister/list 注册表），
 *      调用点写作 `kernel.use(slashCommand({ commands }))`，与上游
 *      `bot.use(slash.middleware)` 语义等价。
 */
import type { Logger, Middleware, MiddlewareContext } from '../../types.ts';

/** 解析出的命令结构，写入 `ctx.state.command` */
export interface ParsedCommand {
  /** 命令名（不含前缀） */
  name: string;
  /** 按空白切分的参数 */
  args: string[];
  /** 参数原文 */
  raw: string;
}

/** handler 返回值：字符串=自动回复文本；noop=静默消费；void=自己发 */
export type SlashCommandResult =
  | string
  | { kind: 'text'; content: string }
  | { kind: 'noop' }
  | void;

/** handler 拿到的上下文（在 MiddlewareContext 上补一个已解析命令） */
export interface SlashCommandHandlerContext extends MiddlewareContext {
  command: ParsedCommand;
}

/** 一条命令的声明（W5 的 commands/buildCommandList 产出同形态对象） */
export interface CommandEntry {
  /** 规范名，不含前缀 */
  name: string;
  /** 别名（同一条命令的其它写法） */
  aliases?: string[];
  /** 帮助里展示的说明 */
  description?: string;
  /** 是否在自动 help 里隐藏 */
  hidden?: boolean;
  /** 执行体：自己发消息（推荐），或返回字符串由中间件代发 */
  handler: (ctx: SlashCommandHandlerContext) => Promise<SlashCommandResult> | SlashCommandResult;
  /** 用法提示（仅帮助展示） */
  usage?: string;
  /** 作用域限制：只在单聊 / 只在群聊 / 只在帖子 / 不限（默认 all） */
  scope?: 'c2c' | 'group' | 'post' | 'all';
  /** 权限检查：返回 true 放行；返回字符串则作为提示发出并拦截 */
  authorized?: (ctx: SlashCommandHandlerContext) => boolean | string;
  /**
   * 快捷指令原生触发词（无前缀）。
   * 客户端点击快捷指令后回传的正文若与触发词完全一致，直接当作该命令执行。
   */
  triggers?: string[];
}

export interface SlashCommandOptions {
  /** 命令前缀，默认 `['/']` */
  prefixes?: string[];
  /** 预注册命令 */
  commands?: CommandEntry[];
  /** handler 抛异常时是否捕获并回一句错误（默认 true） */
  catchErrors?: boolean;
  /** 是否自动注册 /help（默认 true；本插件由 W5 注册 /bot-help，故调用点关掉） */
  autoHelp?: boolean;
  /** 允许使用的发送者（空 = 所有人）；命名与 config.access 一致，可填 `'*'` */
  allowFrom?: string[];
  /** 裸命令名（无前缀）是否也当命令，默认 false —— 只有显式 triggers 才无前缀生效 */
  allowBareNameMatch?: boolean;
  logger?: Logger;
}

/** 带注册表的中间件（注册表可选使用，静态 commands 足够覆盖插件场景） */
export type SlashCommandMiddleware = Middleware & {
  register: (cmd: CommandEntry) => void;
  unregister: (name: string) => void;
  list: () => CommandEntry[];
};

export function slashCommand(options: SlashCommandOptions = {}): SlashCommandMiddleware {
  const prefixes = options.prefixes ?? ['/'];
  const catchErrors = options.catchErrors ?? true;
  const autoHelp = options.autoHelp ?? true;
  const allowFrom = options.allowFrom ?? [];
  const allowBareNameMatch = options.allowBareNameMatch ?? false;
  const log = options.logger;

  const registry = new Map<string, CommandEntry>();

  const register = (cmd: CommandEntry): void => {
    const names = [cmd.name, ...(cmd.aliases ?? []), ...(cmd.triggers ?? [])];
    if (!cmd.name) throw new Error('slash-command: name 不能为空');
    for (const name of names) {
      const key = name.toLowerCase();
      if (registry.has(key)) {
        throw new Error(`slash-command: 命令名重复 "${name}"`);
      }
      registry.set(key, cmd);
    }
  };

  const unregister = (name: string): void => {
    registry.delete(name.toLowerCase());
  };

  /** 去重后列出所有命令（别名共享同一条声明，只列一次） */
  const list = (): CommandEntry[] => {
    const seen = new Set<CommandEntry>();
    const out: CommandEntry[] = [];
    for (const cmd of registry.values()) {
      if (seen.has(cmd)) continue;
      seen.add(cmd);
      out.push(cmd);
    }
    return out;
  };

  for (const cmd of options.commands ?? []) {
    register(cmd);
  }

  // 自动 /help：仅在没有 help 时补一条，避免与 W5 的 /bot-help 重复
  if (autoHelp && !registry.has('help')) {
    register({
      name: 'help',
      description: '列出所有可用指令',
      handler: () => {
        const lines = ['可用指令：'];
        for (const cmd of list()) {
          if (cmd.hidden) continue;
          const names = [cmd.name, ...(cmd.aliases ?? [])].join(' / ');
          const usage = cmd.usage ? ` ${cmd.usage}` : '';
          lines.push(`/${names}${usage}${cmd.description ? ` — ${cmd.description}` : ''}`);
        }
        return lines.join('\n');
      },
    });
  }

  /** 匹配到命令后的发送：兼容上游「handler 返回字符串」的写法 */
  async function sendCommandResult(
    ctx: MiddlewareContext,
    result: SlashCommandResult,
  ): Promise<void> {
    if (result === undefined || result === null) return;
    if (typeof result === 'string') {
      if (result) await ctx.bot.sendMarkdown(ctx.replyTarget, result);
      return;
    }
    if (typeof result === 'object' && result.kind === 'text' && result.content) {
      await ctx.bot.sendMarkdown(ctx.replyTarget, result.content);
    }
    // kind === 'noop' → 静默消费
  }

  const middleware = async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
    const raw = (ctx.message.content ?? '').trim();
    if (!raw) {
      await next();
      return;
    }

    // 全角斜杠是中文输入法下的常见误输入，先归一化再匹配
    const normalized = raw.replace(/^／/, '/');

    // 去掉开头的 @机器人：群里「@bot /status」是最自然的说话方式
    let cleaned = normalized;
    while (/^(?:\{\{\s*tuitui_at\s+"[^"]*"\s*\}\}|@\S+)[\s\u3000]*/.test(cleaned)) {
      cleaned = cleaned.replace(/^(?:\{\{\s*tuitui_at\s+"[^"]*"\s*\}\}|@\S+)[\s\u3000]*/, '');
    }
    cleaned = cleaned.trim();
    if (!cleaned) {
      await next();
      return;
    }

    const prefix = prefixes.find((p) => cleaned.startsWith(p));
    let name: string;
    let rest: string;
    let viaNativeTrigger = false;

    if (prefix) {
      const body = cleaned.slice(prefix.length);
      const match = /^(\S+)(?:\s+(.*))?$/.exec(body);
      if (!match) {
        await next();
        return;
      }
      name = match[1] as string;
      rest = match[2] ?? '';
    } else {
      // 无前缀：只有快捷指令原生触发词（或显式开启的裸命令名）才算命令，
      // 否则群里任何一句「help」都会被吃掉。
      const candidate = registry.get(cleaned.toLowerCase());
      if (!candidate) {
        await next();
        return;
      }
      const isExplicitTrigger = (candidate.triggers ?? []).some(
        (t) => t.toLowerCase() === cleaned.toLowerCase(),
      );
      const isBareName = allowBareNameMatch
        && [candidate.name, ...(candidate.aliases ?? [])].some(
          (n) => n.toLowerCase() === cleaned.toLowerCase(),
        );
      if (!isExplicitTrigger && !isBareName) {
        await next();
        return;
      }
      name = candidate.name;
      rest = '';
      viaNativeTrigger = true;
    }

    const cmd = registry.get(name.toLowerCase());
    if (!cmd) {
      await next();
      return;
    }

    // 群聊 / 帖子：必须 @ 机器人（与上游一致）。快捷指令是显式点击，不需要 @。
    if (!viaNativeTrigger && (ctx.message.kind === 'group' || ctx.message.kind === 'post')) {
      if (ctx.message.atMe !== true) {
        await next();
        return;
      }
    }

    // 发送者白名单：未授权用户发来的「/xxx」按普通消息交给模型，不要静默吞掉
    const isAllowed = allowFrom.length === 0
      || allowFrom.includes('*')
      || allowFrom.includes(ctx.message.senderAccount)
      || allowFrom.includes(ctx.message.senderId);
    if (!isAllowed) {
      await next();
      return;
    }

    const parsed: ParsedCommand = {
      name: name.toLowerCase(),
      args: rest ? rest.split(/\s+/).filter(Boolean) : [],
      raw: rest,
    };
    ctx.state.command = parsed;

    // handler 需要在 ctx 上看到已解析命令：直接挂在同一个 ctx 上（与上游同做法），
    // 这样 handler 里调用 ctx.skip / 读写 state 都作用于同一条消息。
    const handlerCtx = Object.assign(ctx, { command: parsed }) as SlashCommandHandlerContext;

    // 作用域限制
    const cmdScope = cmd.scope ?? 'all';
    if (cmdScope !== 'all' && cmdScope !== ctx.message.kind) {
      const hint = cmdScope === 'c2c'
        ? '该指令仅限私聊使用'
        : cmdScope === 'group' ? '该指令仅限群聊使用' : '该指令仅限团队频道使用';
      await sendCommandResult(ctx, hint);
      ctx.skip('command');
      return;
    }

    // 逐条命令的权限检查
    if (cmd.authorized) {
      const auth = cmd.authorized(handlerCtx);
      if (auth !== true) {
        await sendCommandResult(ctx, typeof auth === 'string' ? auth : '⚠️ 无权限执行此命令');
        ctx.skip('command');
        return;
      }
    }

    try {
      const result = await cmd.handler(handlerCtx);
      await sendCommandResult(ctx, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log?.error(`[slash-command] 命令 "${parsed.name}" 执行失败: ${message}`);
      if (!catchErrors) {
        ctx.skip('command');
        throw err;
      }
      await sendCommandResult(ctx, `⚠️ 命令执行失败：${message}`);
    }

    // 命中命令一律短路：命令已被消费，不再进入会话处理
    ctx.skip('command');
  };

  return Object.assign(middleware, { register, unregister, list });
}

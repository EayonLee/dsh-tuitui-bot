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
export type SlashCommandResult = string | {
    kind: 'text';
    content: string;
} | {
    kind: 'noop';
} | void;
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
export declare function slashCommand(options?: SlashCommandOptions): SlashCommandMiddleware;
//# sourceMappingURL=slash-command.d.ts.map
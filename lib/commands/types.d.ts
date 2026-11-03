/**
 * 命令依赖与注册表类型
 *
 * 上游命令直接实现 QQ SDK 的 SlashCommand（name 可为数组、带 category/usage/authorized 钩子）；
 * 本插件的斜杠命令中间件由 gateway/middleware 自己实现，注册表契约因此收敛为
 * CommandEntry：命令名 + 别名 + 说明 + handler。category/usage 作为可选扩展保留，
 * 只给 /help 分组展示，中间件不读这两个字段。
 */
import type { ImTuituiConfig } from '../config.ts';
import type { SessionManager } from '../session/index.ts';
import type { Logger, MiddlewareContext } from '../types.ts';
export interface CommandDeps {
    manager: SessionManager;
    config: ImTuituiConfig;
    logger?: Logger;
}
/** 命令分类：agent = 底层 dsh agent 通用能力，im = 推推插件特有 */
export type CommandCategory = 'agent' | 'im';
/** 一条斜杠命令（斜杠命令中间件消费的最小契约） */
export interface CommandEntry {
    /** 主命令名（不含前缀） */
    name: string;
    /** 别名：与主命令等价的写法（如 /new 的 reset/clear） */
    aliases?: string[];
    description?: string;
    /** 是否从 /help 隐藏 */
    hidden?: boolean;
    handler: (ctx: MiddlewareContext) => Promise<void> | void;
    /** 帮助分组（可选扩展） */
    category?: CommandCategory;
    /** 用法说明（/help 里补一行） */
    usage?: string;
}
/** 带分类的斜杠命令（category 供 help 分组展示） */
export interface CategorizedCommand extends CommandEntry {
    category: CommandCategory;
}
/**
 * 取命令参数。
 *
 * 优先用中间件解析好的 ctx.state.command（W2 的 slash-command 会写入，与上游
 * SDK 的 state.command 同名）；拿不到时从正文里剥掉命令名——命令实现不绑定
 * 中间件内部细节，两种来源都能工作。
 */
export declare function commandArgs(ctx: MiddlewareContext): string;
/** 统一回复：命令输出全部走分块发送（长表格/模型列表不会撞推推单条上限） */
export declare function replyText(ctx: MiddlewareContext, config: ImTuituiConfig, content: string): Promise<void>;
//# sourceMappingURL=types.d.ts.map
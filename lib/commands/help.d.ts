/**
 * /help（别名 /bot-help）— 查看所有指令，按「通用能力 / 插件内置指令」分组展示
 *
 * 通用能力：对应底层 dsh agent 能力（new/compact/model/preset/stop）
 * 插件内置：推推插件自身封装（bot-ping/bot-version/bot-status/bot-help/bind）
 *
 * 中间件关闭了 autoHelp（见 gateway/middleware-setup 第 8 条），帮助文本完全由
 * 本命令提供——否则会同时存在 SDK 自动生成的 /help 与本命令，两份内容不一致。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
/** /help — 分组查看所有指令 */
export declare function helpCommand({ config }: CommandDeps, allCommands: () => CategorizedCommand[]): CategorizedCommand;
//# sourceMappingURL=help.d.ts.map
/**
 * 斜杠命令注册中心
 *
 * 每个命令拆分为独立文件，此处仅编排。工厂函数注入依赖，统一导出命令列表。
 *
 * 命令按 category 分两类：
 *   - agent：底层 dsh agent 通用能力（new/compact/model/preset/stop）
 *   - im：推推插件自身特有（ping/version/me/status/help/bind）
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
export type { CommandDeps, CommandEntry, CategorizedCommand, CommandCategory } from './types.ts';
export { commandArgs, replyText } from './types.ts';
/**
 * 构建标准命令列表（斜杠命令中间件消费）
 */
export declare function buildCommandList(deps: CommandDeps): CategorizedCommand[];
//# sourceMappingURL=index.d.ts.map
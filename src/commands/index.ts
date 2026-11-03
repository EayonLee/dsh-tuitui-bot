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
import { newCommand, compactCommand } from './session.ts';
import { modelCommand } from './model.ts';
import { presetCommand } from './preset.ts';
import { statusCommand } from './status.ts';
import { helpCommand } from './help.ts';
import { pingCommand, versionCommand, stopCommand, meCommand } from './misc.ts';
import { bindCommand } from './bind.ts';

export type { CommandDeps, CommandEntry, CategorizedCommand, CommandCategory } from './types.ts';
export { commandArgs, replyText } from './types.ts';

/**
 * 构建标准命令列表（斜杠命令中间件消费）
 */
export function buildCommandList(deps: CommandDeps): CategorizedCommand[] {
  const commands: CategorizedCommand[] = [
    // 通用能力（底层 agent）
    newCommand(deps),
    compactCommand(deps),
    modelCommand(deps),
    presetCommand(deps),
    stopCommand(deps),
    // 推推插件特有
    pingCommand(deps),
    versionCommand(deps),
    meCommand(deps),
    statusCommand(deps),
    bindCommand(deps),
  ];

  // help 需要访问完整列表（含自身），通过闭包惰性引用
  commands.push(helpCommand(deps, () => commands));

  return commands;
}

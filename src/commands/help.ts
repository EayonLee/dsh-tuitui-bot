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
import { replyText } from './types.ts';
import { PLUGIN_VERSION } from '../shared/index.ts';

/** /help — 分组查看所有指令 */
export function helpCommand(
  { config }: CommandDeps,
  allCommands: () => CategorizedCommand[],
): CategorizedCommand {
  return {
    name: 'help',
    aliases: ['bot-help'],
    category: 'im',
    description: '查看所有指令',
    handler: async (ctx) => {
      const agentCmds: CategorizedCommand[] = [];
      const imCmds: CategorizedCommand[] = [];
      for (const cmd of allCommands()) {
        if (cmd.hidden) continue;
        (cmd.category === 'agent' ? agentCmds : imCmds).push(cmd);
      }

      const render = (cmds: CategorizedCommand[]): string[] => {
        const out: string[] = [];
        for (const cmd of cmds) {
          const names = [cmd.name, ...(cmd.aliases ?? [])].map((n) => `/${n}`).join(' ');
          out.push(`- \`${names}\` ${cmd.description ?? ''}`.trimEnd());
        }
        return out;
      };

      const lines: string[] = ['### 🤖 推推机器人指令', ''];

      if (agentCmds.length > 0) {
        lines.push('**通用能力**', '', ...render(agentCmds), '');
      }
      if (imCmds.length > 0) {
        lines.push('**插件内置指令**', '', ...render(imCmds), '');
      }

      lines.push('', `> dsh-tuitui-bot v${PLUGIN_VERSION}`);
      await replyText(ctx, config, lines.join('\n'));
    },
  };
}

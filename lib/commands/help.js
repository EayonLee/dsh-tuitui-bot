import { replyText } from "./types.js";
import { PLUGIN_VERSION } from "../shared/index.js";
/** /help — 分组查看所有指令 */
export function helpCommand({ config }, allCommands) {
    return {
        name: 'help',
        aliases: ['bot-help'],
        category: 'im',
        description: '查看所有指令',
        handler: async (ctx) => {
            const agentCmds = [];
            const imCmds = [];
            for (const cmd of allCommands()) {
                if (cmd.hidden)
                    continue;
                (cmd.category === 'agent' ? agentCmds : imCmds).push(cmd);
            }
            const render = (cmds) => {
                const out = [];
                for (const cmd of cmds) {
                    const names = [cmd.name, ...(cmd.aliases ?? [])].map((n) => `/${n}`).join(' ');
                    out.push(`- \`${names}\` ${cmd.description ?? ''}`.trimEnd());
                }
                return out;
            };
            const lines = ['### 🤖 推推机器人指令', ''];
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
//# sourceMappingURL=help.js.map
/**
 * Preset 命令：/preset — 查看或切换 agent preset
 *
 * 无参数列出可用 preset（可点击切换），有参数切换，reset/default 重置为默认。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { commandArgs, replyText } from './types.ts';
import { commandAllowlistAuth } from './auth.ts';
import { getScopePeer } from '../shared/index.ts';

export function presetCommand({ manager, config, logger }: CommandDeps): CategorizedCommand {
  return {
    name: 'preset',
    category: 'agent',
    // 管理类指令：私聊/群聊/帖子均可用，但仅限白名单用户（复用审批的名单语义）
    description: '查看或切换 agent preset（用法: /preset [id]）',
    usage: '/preset [id]',
    handler: async (ctx) => {
      // CommandEntry 没有 authorized 钩子，白名单校验前移到 handler 首行
      const denied = commandAllowlistAuth(config, logger)(ctx);
      if (typeof denied === 'string') {
        await replyText(ctx, config, denied);
        return;
      }

      const { scope, peerId } = getScopePeer(ctx.message);
      const args = commandArgs(ctx);

      // 无参数：列出可用 preset + 当前
      if (!args) {
        const presets = await manager.listPresets();
        if (presets.length === 0) {
          await replyText(ctx, config, '当前部署无可用的 agent preset');
          return;
        }

        const record = manager.getSessionRecord(scope, peerId);
        const currentId = record?.agentPreset ?? manager.getEffectivePreset(scope, peerId);

        const lines: string[] = ['### 🧩 Agent Preset', ''];
        lines.push(`**当前:** ${currentId ?? '默认'}`);
        lines.push('', '**可用 preset（复制指令切换）:**');
        for (const p of presets) {
          const display = p.name ? `${p.name} (${p.id})` : p.id;
          lines.push(`- \`/preset ${p.id}\` · ${display}`);
        }
        lines.push('', '手动指定: `/preset <id>`，重置默认: `/preset reset`');

        await replyText(ctx, config, lines.join('\n'));
        return;
      }

      // reset / default：清除 per-peer 覆盖，回到默认
      if (args === 'reset' || args === 'default') {
        const outcome = await manager.clearPresetOverride(scope, peerId);
        await replyText(ctx, config, outcome.ok ? '✅ 已重置为默认 preset（新会话生效）' : '重置失败');
        return;
      }

      // 切换到指定 preset
      const outcome = await manager.setPresetOverride(scope, peerId, args);
      if (!outcome.ok) {
        let text: string;
        switch (outcome.reason) {
          case 'unavailable':
            text = '当前部署不支持 agent preset（agentPresets 服务未注入）';
            break;
          case 'unknown-preset':
            text = `未知 preset: ${args}`;
            break;
          case 'broken':
            text = `preset ${args} 加载失败: ${outcome.message ?? '未知错误'}`;
            break;
          default:
            text = `切换失败: ${outcome.message ?? '未知错误'}`;
        }
        await replyText(ctx, config, text);
        return;
      }

      await replyText(
        ctx,
        config,
        `✅ preset 已切换: ${args}\n新会话生效（当前会话保持原 preset，发送 /new 后生效）。`,
      );
    },
  };
}

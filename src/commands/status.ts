/**
 * 状态命令：/status（别名 /bot-status，推推插件特有）
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { replyText } from './types.ts';
import { getScopePeer, formatRelativeTime } from '../shared/index.ts';

/** /status — 查看当前会话状态 */
export function statusCommand({ manager, config }: CommandDeps): CategorizedCommand {
  return {
    name: 'status',
    aliases: ['bot-status'],
    category: 'im',
    description: '查看当前会话状态',
    handler: async (ctx) => {
      const { scope, peerId } = getScopePeer(ctx.message);
      const status = manager.getStatus(scope, peerId);
      if (!status.active) {
        await replyText(ctx, config, '当前无活跃会话');
        return;
      }
      const modelInfo = status.model ? `${status.provider}/${status.model}` : '宿主默认';
      const lines = [
        '📊 会话状态',
        `会话: ${status.sessionId ? status.sessionId.slice(0, 8) : '—'}`,
        `作用域: ${scope}`,
        `模型: ${modelInfo}`,
        `Preset: ${status.preset ?? '无'}`,
        `消息数: ${status.messageCount ?? 0}`,
        `最后活动: ${formatRelativeTime(status.lastActivity)}`,
      ];
      await replyText(ctx, config, lines.join('\n'));
    },
  };
}

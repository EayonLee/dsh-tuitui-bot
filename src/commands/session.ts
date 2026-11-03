/**
 * 会话相关命令
 *
 * - /new（别名 /reset /clear）：开始新会话（换新 sessionId）
 * - /compact：原地压缩会话历史（保留 sessionId，摘要替换旧历史）
 *
 * 两者都对应底层 dsh agent 能力，分类为 agent（通用能力）。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { replyText } from './types.ts';
import { getScopePeer } from '../shared/index.ts';
import { clearFollowUp } from '../features/followup-store.ts';

/** /new（别名 /reset /clear）— 开始新会话 */
export function newCommand({ manager, config }: CommandDeps): CategorizedCommand {
  return {
    name: 'new',
    aliases: ['reset', 'clear'],
    category: 'agent',
    description: '开始新会话（清空上下文）',
    handler: async (ctx) => {
      const { scope, peerId } = getScopePeer(ctx.message);
      // 先回执再回收集：remove 要等 agent dispose，慢的时候用户会以为没反应
      await replyText(ctx, config, '已开启新会话 ✓');
      // 新会话之后不该再把用户的下一条当成「刚才那段对话的延续」
      clearFollowUp(scope, peerId);
      void manager.remove(scope, peerId);
    },
  };
}

/** /compact — 原地压缩会话历史 */
export function compactCommand({ manager, config }: CommandDeps): CategorizedCommand {
  return {
    name: 'compact',
    category: 'agent',
    description: '压缩会话历史（摘要替换旧记录，保留上下文）',
    handler: async (ctx) => {
      const { scope, peerId } = getScopePeer(ctx.message);
      const msg = ctx.message;
      const outcome = await manager.compact(scope, peerId, {
        senderId: msg.senderId,
        replyTarget: { scope, targetId: peerId, msgId: msg.messageId },
      });

      if (outcome.ok) {
        const text = outcome.shadowed
          ? `✅ 已压缩 ${outcome.shadowed} 条历史记录（约 ${outcome.tokens ?? 0} tokens）`
          : '没有可压缩的历史';
        await replyText(ctx, config, text);
        return;
      }

      let text: string;
      switch (outcome.reason) {
        case 'no-session':
          text = '当前无活跃会话';
          break;
        case 'busy':
          text = '正在生成中，无法压缩';
          break;
        case 'unavailable':
          text = '压缩能力不可用（当前会话的 agent preset 未加载 compaction 服务）';
          break;
        default:
          text = `压缩失败: ${outcome.message ?? '未知错误'}`;
      }
      await replyText(ctx, config, text);
    },
  };
}

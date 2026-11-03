import { replyText } from "./types.js";
import { getScopePeer } from "../shared/index.js";
/** /new（别名 /reset /clear）— 开始新会话 */
export function newCommand({ manager, config }) {
    return {
        name: 'new',
        aliases: ['reset', 'clear'],
        category: 'agent',
        description: '开始新会话（清空上下文）',
        handler: async (ctx) => {
            const { scope, peerId } = getScopePeer(ctx.message);
            // 先回执再回收集：remove 要等 agent dispose，慢的时候用户会以为没反应
            await replyText(ctx, config, '已开启新会话 ✓');
            void manager.remove(scope, peerId);
        },
    };
}
/** /compact — 原地压缩会话历史 */
export function compactCommand({ manager, config }) {
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
            let text;
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
//# sourceMappingURL=session.js.map
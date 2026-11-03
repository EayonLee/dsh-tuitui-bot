/**
 * 杂项命令
 *
 * - /bot-ping /bot-version /bot-me：推推插件特有（连通性测试、版本、身份）
 * - /stop：中止当前生成（对应底层 agent cancel，通用能力）
 *
 * 推推 SDK 不会自动把 handler 的返回字符串发出去，因此每个命令自己调
 * replyText 发送（所以 ping 也需要拿到 config）。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { replyText } from './types.ts';
import { getScopePeer, PLUGIN_VERSION } from '../shared/index.ts';

/** /bot-ping — 测试当前 dsh 与推推连接的网络延迟 */
export function pingCommand({ config }: CommandDeps): CategorizedCommand {
  return {
    name: 'bot-ping',
    category: 'im',
    description: '测试当前 dsh 与推推连接的网络延迟',
    usage: [
      '/bot-ping',
      '',
      '测试 dsh 主机与推推服务器之间的网络延迟。',
      '返回从事件产生到插件处理的总耗时。',
    ].join('\n'),
    handler: async (ctx) => {
      const ts = ctx.message.timestamp;
      const eventTime = ts ? new Date(ts).getTime() : NaN;
      if (Number.isNaN(eventTime)) {
        await replyText(ctx, config, '✅ pong!');
        return;
      }
      // 中间件上下文没有 receivedAt，只能给总耗时（网络 + 排队 + 插件处理）
      const totalMs = Date.now() - eventTime;
      await replyText(ctx, config, ['✅ pong！', `⏱ 延迟: ${totalMs}ms`].join('\n'));
    },
  };
}

/** /bot-version — 查看版本信息 */
export function versionCommand({ manager, config }: CommandDeps): CategorizedCommand {
  return {
    name: 'bot-version',
    category: 'im',
    description: '查看版本信息',
    handler: async (ctx) => {
      const current = manager.getEffectiveModel('c2c', '');
      const modelInfo = current ? `${current.provider}/${current.model}` : '宿主默认';
      await replyText(ctx, config, `dsh-tuitui-bot v${PLUGIN_VERSION} | model: ${modelInfo}`);
    },
  };
}

/**
 * /bot-me — 查看发送者身份标识
 *
 * 私聊返回域账号与 uid、群聊额外返回 group_id、帖子额外返回频道定位
 * （分别对应 access.c2cAllow / groupAllow / postAllow 的名单 key）。
 * 首次配置白名单时最常用的一条命令，未显式 @ 也能拿到自己的账号。
 */
export function meCommand({ config }: CommandDeps): CategorizedCommand {
  return {
    name: 'bot-me',
    category: 'im',
    description: '查看你的账号标识（白名单配置用）',
    handler: async (ctx) => {
      const msg = ctx.message;
      const lines = [
        `🆔 你的域账号：**${msg.senderAccount || '(未知)'}**`,
        `🆔 你的 UID：**${msg.senderId || '(未知)'}**`,
      ];
      if (msg.groupId) {
        lines.push(`👥 本群 group_id：**${msg.groupId}**`);
      }
      if (msg.post) {
        lines.push(`📌 团队 **${msg.post.teamId}** / 频道 **${msg.post.channelId}**`);
      }
      await replyText(ctx, config, lines.join('\n'));
    },
  };
}

/** /stop — 中止当前生成（隐藏） */
export function stopCommand({ manager, config }: CommandDeps): CategorizedCommand {
  return {
    name: 'stop',
    category: 'agent',
    description: '中止当前生成',
    hidden: true,
    handler: async (ctx) => {
      const { scope, peerId } = getScopePeer(ctx.message);
      const record = manager.getSessionRecord(scope, peerId);
      // 会话存在不等于正在生成：只有 agent 处于 running 才算有进行中的回复
      if (record === undefined || record.agent.status !== 'running') {
        await replyText(ctx, config, '当前没有进行中的生成');
        return;
      }

      // cancel 会让当前轮以 turn/end (kind=interrupted) 收尾，
      // 出站侧据此 flush 已生成的文本并关闭流式会话。
      record.agent.cancel({ kind: 'user' });
      await replyText(ctx, config, '已中止 ⛔');
    },
  };
}

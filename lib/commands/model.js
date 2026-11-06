import { commandArgs, replyText } from "./types.js";
import { commandAllowlistAuth } from "./auth.js";
import { getScopePeer } from "../shared/index.js";
export function modelCommand({ manager, config, logger }) {
    return {
        name: 'model',
        category: 'agent',
        // 管理类指令：私聊/群聊/帖子均可用，但仅限白名单用户（与 /preset 同构）
        description: '查看或切换模型（用法: /model [provider/model]）',
        usage: '/model [provider/model]',
        handler: async (ctx) => {
            // CommandEntry 没有 authorized 钩子，白名单校验前移到 handler 首行
            const denied = commandAllowlistAuth(config, logger)(ctx);
            if (typeof denied === 'string') {
                await replyText(ctx, config, denied);
                return;
            }
            const { scope, peerId } = getScopePeer(ctx.message);
            const args = commandArgs(ctx);
            // 无参数：显示当前模型 + 可用模型列表（可点击）
            if (!args) {
                const current = manager.getEffectiveModel(scope, peerId);
                const models = await manager.listAvailableModels();
                // 当前模型展示：优先用别名（name），找不到别名时回退到 provider/model id
                let currentDisplay = '宿主默认配置';
                if (current) {
                    const matched = models.find((m) => m.provider === current.provider && m.id === current.model);
                    currentDisplay = matched?.name ?? `${current.provider}/${current.model}`;
                }
                const lines = [
                    '### 🤖 模型配置',
                    '',
                    `**当前模型:** ${currentDisplay}`,
                ];
                if (models.length > 0) {
                    lines.push('', '**可用模型（复制指令切换）:**');
                    for (const m of models) {
                        const modelPath = `${m.provider}/${m.id}`;
                        const displayName = m.name ? `${m.name}` : modelPath;
                        lines.push(`- \`/model ${modelPath}\` · ${displayName}`);
                    }
                }
                lines.push('', '手动指定: `/model provider/model`');
                await replyText(ctx, config, lines.join('\n'));
                return;
            }
            // 解析 provider/model 格式
            let provider;
            let model;
            if (args.includes('/')) {
                const parts = args.split('/');
                provider = parts[0] ?? '';
                model = parts.slice(1).join('/');
            }
            else {
                // 仅指定 model 名，provider 从当前路由继承
                const current = manager.getEffectiveModel(scope, peerId);
                provider = current?.provider ?? 'deepseek-official';
                model = args;
            }
            if (!provider || !model) {
                await replyText(ctx, config, '用法: /model provider/model\n示例: /model deepseek-official/deepseek-v4-flash');
                return;
            }
            const outcome = await manager.setModelOverride(scope, peerId, { provider, model });
            if (!outcome.ok) {
                await replyText(ctx, config, '⏳ 当前还在生成回答，现在切换会把这一轮打断。\n等它说完，或先 /stop 再 /model。');
                return;
            }
            if (outcome.appliesTo === 'next-session') {
                await replyText(ctx, config, `✅ 已记住模型: ${provider}/${model}\n下一条新会话生效。`);
                return;
            }
            await replyText(ctx, config, `✅ 模型已切换: ${provider}/${model}\n立即生效，对话上下文保留。`);
        },
    };
}
//# sourceMappingURL=model.js.map
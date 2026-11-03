import { replyText } from "./types.js";
/** AppID 只回显首尾，避免把凭据全文打进聊天记录 */
function maskSecret(value) {
    const s = value.trim();
    if (!s)
        return '(缺失)';
    if (s.length <= 6)
        return `${s.slice(0, 2)}***`;
    return `${s.slice(0, 4)}***${s.slice(-2)}`;
}
/** /bind — 查看绑定状态与设置页提示 */
export function bindCommand({ config }) {
    return {
        name: 'bind',
        category: 'im',
        description: '查看机器人绑定状态与设置入口',
        handler: async (ctx) => {
            const lines = [
                '### 🔗 推推机器人绑定',
                '',
                `**AppID:** ${maskSecret(config.appId)}`,
                `**AppSecret:** ${config.appSecret ? '已配置' : '(缺失)'}`,
                `**API 地址:** ${config.apiBaseUrl || '默认（公网服务）'}`,
                `**WebSocket:** ${config.websocketBaseUrl || '默认（公网服务）'}`,
            ];
            if (!config.appId || !config.appSecret) {
                lines.push('', '⚠️ 凭据不完整，机器人无法收发消息。');
            }
            lines.push('', '**更换凭据：**', '1. 打开 dsh 设置页 → 插件 → **推推机器人**', '2. 填入 AppID / AppSecret 并保存（写入 profile 的 cordis.patch.yml 后自动重载）', '3. 私有化部署可在同一面板填写 API / WebSocket 地址');
            await replyText(ctx, config, lines.join('\n'));
        },
    };
}
//# sourceMappingURL=bind.js.map
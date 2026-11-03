const DENIED = '⚠️ 无权限执行此命令';
/** 构造命令白名单鉴权回调 */
export function commandAllowlistAuth(config, logger) {
    return (ctx) => {
        if (config.access.c2cMode !== 'allowlist')
            return true;
        const ids = [ctx.message.senderAccount, ctx.message.senderId].filter((id) => typeof id === 'string' && id.length > 0);
        if (ids.length === 0 || !ids.some((id) => config.access.c2cAllow.includes(id))) {
            logger?.warn(`im-tuitui: command auth denied: sender=${ids[0] ?? '(missing)'}`);
            return DENIED;
        }
        return true;
    };
}
//# sourceMappingURL=auth.js.map
/**
 * 命令鉴权 — 挂到命令 handler 首行的白名单校验
 *
 * 名单语义与审批按钮校验（approval-channel）一致：c2cMode=allowlist 时发送者
 * 必须在 c2cAllow；身份缺失同样拒绝（fail-closed）。open 模式放行。
 *
 * 上游把校验挂在 SDK 的 SlashCommand.authorized 钩子上；本插件的 CommandEntry
 * 没有这个钩子（中间件不参与业务鉴权），因此由管理类命令在 handler 首行调用。
 */
import type { Logger } from '../types.ts';
/** 鉴权配置投影（结构化，便于单测） */
export interface CommandAuthConfigLike {
    access: {
        c2cMode: 'open' | 'allowlist' | 'disabled';
        c2cAllow: readonly string[];
    };
}
/** 鉴权只关心发送者身份（上游用 openid；推推同时有域账号与 uid） */
export interface CommandAuthContextLike {
    message: {
        senderId?: string;
        senderAccount?: string;
    };
}
/** 构造命令白名单鉴权回调 */
export declare function commandAllowlistAuth(config: CommandAuthConfigLike, logger?: Logger): (ctx: CommandAuthContextLike) => boolean | string;
//# sourceMappingURL=auth.d.ts.map
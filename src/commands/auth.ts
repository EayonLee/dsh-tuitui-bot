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
    c2cMode: 'open' | 'allowlist' | 'blocklist' | 'disabled';
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

const DENIED = '⚠️ 无权限执行此命令';

/** 构造命令白名单鉴权回调 */
export function commandAllowlistAuth(
  config: CommandAuthConfigLike,
  logger?: Logger,
): (ctx: CommandAuthContextLike) => boolean | string {
  return (ctx) => {
    if (config.access.c2cMode !== 'allowlist') return true;
    const ids = [ctx.message.senderAccount, ctx.message.senderId].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (ids.length === 0 || !ids.some((id) => config.access.c2cAllow.includes(id))) {
      logger?.warn(`im-tuitui: command auth denied: sender=${ids[0] ?? '(missing)'}`);
      return DENIED;
    }
    return true;
  };
}

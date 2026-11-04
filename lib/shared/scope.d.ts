/**
 * scope 提取工具
 *
 * 统一从入站消息提取 (scope, peerId)，避免各处重复推导造成漂移。
 */
import type { ChatScope, InboundMessage } from '../types.ts';
/** 从入站消息提取 scope + peerId（与 inbound 的 replyTarget 推导保持一致） */
export declare function getScopePeer(message: InboundMessage): {
    scope: ChatScope;
    peerId: string;
};
/**
 * 从会话键里取回对端 id（键格式 `tuitui:${scope}:${peerId}`）。
 *
 * 卡片点击的兜底匹配要用它核对"是不是同一个对端"：回调事件体里的身份字段
 * （域账号 / uid）有时和入站消息不同，直接按 sessionKey 查会查不到，但不能
 * 因此把别人的点击认成自己的。
 */
export declare function peerFromSessionKey(sessionKey: string, scope: string): string;
//# sourceMappingURL=scope.d.ts.map
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
//# sourceMappingURL=scope.d.ts.map
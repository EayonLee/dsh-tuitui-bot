/** 从入站消息提取 scope + peerId（与 inbound 的 replyTarget 推导保持一致） */
export function getScopePeer(message) {
    if (message.kind === 'group') {
        return { scope: 'group', peerId: message.groupId ?? message.senderId };
    }
    if (message.kind === 'post') {
        return { scope: 'post', peerId: message.post?.channelId ?? message.messageId };
    }
    return { scope: 'c2c', peerId: message.senderAccount || message.senderId };
}
//# sourceMappingURL=scope.js.map
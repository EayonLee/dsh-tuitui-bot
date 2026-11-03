import { createMiddlewareContext } from "./kernel.js";
/** 造一条入站消息（默认群聊场景） */
export function makeMessage(partial = {}) {
    return {
        eventType: 'group_chat',
        kind: 'group',
        senderId: 'uid-1',
        senderAccount: 'zhangsan',
        senderName: '张三',
        content: 'hello',
        messageId: 'msg-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        groupId: 'group-1',
        attachments: [],
        raw: {},
        ...partial,
    };
}
/** 造一个只记录调用的假 sender */
export function makeBot(overrides = {}) {
    return {
        sendMarkdown: async () => ({}),
        openStream: () => null,
        sendInteractive: async () => ({}),
        modifyInteractive: async () => undefined,
        sendImage: async () => ({}),
        sendFile: async () => ({}),
        recall: async () => undefined,
        emojiReaction: async () => undefined,
        ...overrides,
    };
}
/** 由消息推导回复目标（与 tuitui/inbound 的推导规则一致） */
export function makeReplyTarget(message) {
    if (message.kind === 'post' && message.post) {
        return {
            scope: 'post',
            targetId: message.post.channelId,
            teamId: message.post.teamId,
            channelId: message.post.channelId,
            postId: message.post.postId,
            msgId: message.messageId,
        };
    }
    const targetId = message.kind === 'group' ? (message.groupId ?? message.senderId) : message.senderId;
    return { scope: message.kind, targetId, msgId: message.messageId, at: [] };
}
/** 造一个完整的中间件上下文 */
export function makeCtx(message = makeMessage(), bot = makeBot()) {
    return createMiddlewareContext({ message, replyTarget: makeReplyTarget(message), bot });
}
/** 跑一层中间件，返回「下游是否被调用」 */
export async function runMiddleware(middleware, ctx) {
    let reachedNext = false;
    await middleware(ctx, async () => {
        reachedNext = true;
    });
    return { reachedNext };
}
/** 可控的延迟闸门：用于断言「上一条没处理完时发生了什么」 */
export function createGate() {
    let open;
    const wait = new Promise((resolve) => {
        open = resolve;
    });
    return { wait, open };
}
//# sourceMappingURL=test-utils.js.map
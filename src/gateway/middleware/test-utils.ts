/**
 * 中间件单测的公共脚手架
 *
 * 刻意不依赖 vitest：本文件会被 tsc 一起编译（tsconfig 只排除 *.test.ts），
 * 保持纯函数与零副作用，才不会让测试工具混进生产构建。
 */
import type { InboundMessage, Middleware, MiddlewareContext, ReplyTarget, TuituiSender } from '../../types.ts';
import { createMiddlewareContext } from './kernel.ts';

/** 造一条入站消息（默认群聊场景） */
export function makeMessage(partial: Partial<InboundMessage> = {}): InboundMessage {
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
export function makeBot(overrides: Partial<TuituiSender> = {}): TuituiSender {
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
export function makeReplyTarget(message: InboundMessage): ReplyTarget {
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
export function makeCtx(
  message: InboundMessage = makeMessage(),
  bot: TuituiSender = makeBot(),
): MiddlewareContext {
  return createMiddlewareContext({ message, replyTarget: makeReplyTarget(message), bot });
}

/** 跑一层中间件，返回「下游是否被调用」 */
export async function runMiddleware(
  middleware: Middleware,
  ctx: MiddlewareContext,
): Promise<{ reachedNext: boolean }> {
  let reachedNext = false;
  await middleware(ctx, async () => {
    reachedNext = true;
  });
  return { reachedNext };
}

/** 可控的延迟闸门：用于断言「上一条没处理完时发生了什么」 */
export function createGate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

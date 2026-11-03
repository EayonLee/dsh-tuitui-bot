/**
 * 推推事件归一化 — TuituiEventBody → InboundMessage
 *
 * 上游这一步由 @tencent-connect/qqbot-nodejs 的 SDK 完成（C2C_MESSAGE_CREATE /
 * GROUP_AT_MESSAGE_CREATE → MiddlewareContext.message）。推推 SDK 只提供
 * 事件体与文本渲染，因此这里集中做一次映射，后续中间件/传输层只认 InboundMessage。
 *
 * 支持的事件：
 * - single_chat       单聊消息
 * - group_chat        群聊消息（带 at_me / at[]）
 * - teams_post_create 团队频道帖子（含回帖）
 * - interactive_action 交互卡片点击回调（审批/问答按钮）
 * 其它事件（建群、成员变更、频道变更等）返回 null，由 gateway 决定是否记日志。
 */
import type { TuituiEventBody } from '@qihoo/tuitui-bot-sdk';
import type { InboundAttachment, InboundMessage } from '../types.ts';
/** 渲染消息正文的注入点（来自 client.event.renderMessageBody，避免在纯函数里持有客户端） */
export type MessageRenderer = (data: unknown) => string;
export interface NormalizeOptions {
    render: MessageRenderer;
}
/** 归一化入口：不认识的推推事件返回 null */
export declare function normalizeEvent(body: TuituiEventBody, options: NormalizeOptions): InboundMessage | null;
/** 事件名是否属于"消息类"（用于 gateway 的忽略日志降噪） */
export declare function isMessageEvent(event: string): boolean;
/** MIME → 附件类别 */
export declare function classifyMime(mimeType: string | undefined): InboundAttachment['kind'];
//# sourceMappingURL=inbound.d.ts.map
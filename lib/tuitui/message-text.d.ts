/**
 * 消息正文的兜底文案。
 *
 * 事故背景（issue #18）：推推每加一种 `msg_type`，只要 SDK 没有对应渲染分支，
 * 归一出的事件就是空串——模型看到一条"什么都没有"的消息，日志里也查不出
 * 到底是哪个类型掉的。宁可写清楚"读不了"，也不要静默空着。
 */
/** 未知消息类型的可读占位，例如 `[未支持的消息类型: page]` */
export declare function unsupportedMessageText(msgType: string | undefined): string;
/** 从消息体里取 msg_type（推推偶尔给非字符串，一律当没有） */
export declare function readMsgType(data: unknown): string | undefined;
//# sourceMappingURL=message-text.d.ts.map
/**
 * 追问窗口记录 — 支撑「智能触发」模式
 *
 * 单纯的「必须 @」会漏掉自然对话：用户 @ 过一次之后接着追问「那再帮我改下」
 * 往往不会再 @。这里只记「机器人最近一次在该会话里说过话」的时间与对象，
 * 由 mention-gate 判断「这条消息是不是刚才那轮对话的延续」。
 *
 * 只保留内存态：进程重启后没记录 = 必输 @，宁可少答也不要乱插话。
 */
export interface FollowUpEntry {
    /** 机器人最后一次回复时间（ms） */
    at: number;
    /** 当时对话的人（域账号或 uid） */
    senderId: string;
}
/** 记录一次机器人回复（由出站链路在产出文本时调用） */
export declare function markBotReply(scope: string, peerId: string, senderId: string, now?: number): void;
/**
 * 这条消息是不是「刚聊过」的延续。
 *
 * 判定条件（都满足才算）：
 *   1. 该会话在 windowMs 内有过机器人回复；
 *   2. 发送者是当时对话的同一个人（换人说话不算延续，避免抢答别人的问题）。
 */
export declare function isLikelyFollowUp(scope: string, peerId: string, senderId: string, windowMs: number, now?: number): boolean;
/** 清掉某个会话的追问标记（/new 重置后调用，避免把旧对话当成延续） */
export declare function clearFollowUp(scope: string, peerId: string): void;
/** 清空（测试用） */
export declare function clearFollowUps(): void;
//# sourceMappingURL=followup-store.d.ts.map
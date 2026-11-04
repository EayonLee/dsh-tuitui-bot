/**
 * 机器人最近一次说话的记录（会话重置时清掉）。
 *
 * 智能模式已经不靠它判断要不要插嘴——那是模型的事。这里只剩两件事：
 * 出站时打个时间戳、/new 重置时清掉，给状态查询/排障用。
 */
export interface FollowUpEntry {
    /** 机器人最后一次回复时间（ms） */
    at: number;
    /** 当时对话的人（域账号或 uid） */
    senderId: string;
}
/** 记录一次机器人回复（由出站链路在产出文本时调用） */
export declare function markBotReply(scope: string, peerId: string, senderId: string, now?: number): void;
/** 清掉某个会话的追问标记（/new 重置后调用，避免把旧对话当成延续） */
export declare function clearFollowUp(scope: string, peerId: string): void;
/** 清空（测试用） */
export declare function clearFollowUps(): void;
//# sourceMappingURL=followup-store.d.ts.map
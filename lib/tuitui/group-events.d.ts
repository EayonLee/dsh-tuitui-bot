/**
 * 群事件 → 一条"系统通知"。
 *
 * 被拉进群、被踢出群、群建好了——这些不是消息事件，normalizeEvent 解不出来。
 * 但机器人得知道：不然它在群里出现，自己都不知道自己怎么来的。
 *
 * 处理方式：写一条系统消息进判定历史（只加不删的那份），下一轮判定就能看到
 * "我 12:03 被李正泰拉进了群 X"。默认不主动在群里说话，免得一进群就刷屏。
 */
import type { HistoryStore } from '../features/history-store.ts';
import type { Logger } from '../types.ts';
export type GroupEventKind = 'group_create' | 'group_invite' | 'group_kick';
export interface GroupEventResult {
    groupId?: string;
    text: string;
}
/**
 * 识别群事件并生成系统通知；不是群事件返回 undefined。
 *
 * @param event 推推事件名（body.event）
 * @param data  事件体（body.data）
 */
export declare function describeGroupEvent(event: string, data: unknown): GroupEventResult | undefined;
/** 把群事件写进判定历史（写不进去只记 warn，不影响主流程） */
export declare function recordGroupEvent(store: HistoryStore, key: string, notice: GroupEventResult, logger: Logger): void;
//# sourceMappingURL=group-events.d.ts.map
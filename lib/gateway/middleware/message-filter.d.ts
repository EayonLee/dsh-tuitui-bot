/**
 * 消息过滤中间件 — 丢弃无效 / 重复 / 自回声消息
 *
 * 两件事合在一次处理里（与上游一致）：
 *   1. **自回声**：推推在某些场景下会把机器人自己发出的消息再作为入站事件推回来
 *      （尤其是群聊），不拦住就会自己回复自己，形成死循环。
 *   2. **去重**：事件重投 / 网关重连重叠时同一条消息可能到达两次，重复处理会
 *      让同一轮对话被触发两遍、并重复消耗额度。
 *
 * ## 自回声判据（#45 的结论）
 *
 * 平台的入站事件体带 `user_is_bot?: boolean`（SDK `events.d.ts` 里就有），
 * 归一化层把它映射成 `fromBot`（见 `tuitui/inbound.ts`），所以「这条是机器人发的」
 * 这件事本身是有据可查的。
 *
 * 但**平台会不会把机器人自己刚发的消息再推回给它自己**，从代码/SDK 里证明不了。
 * 结论：不赌。默认开启 `skipSelfEcho`，另加一条身份兜底 `selfIds`（appId / 机器人账号）——
 * 万一平台没打 `user_is_bot`，只要发送者就是机器人自己，也在这里丢掉。
 * `selfIds` 命中会打一条 info（正常情况下永远不该出现，出现即说明回声是真的）。
 *
 * 去重只留 msgid + 过期时间，用「懒淘汰」而不是定时器：消息量有上限（maxSize），
 * 每次写入时顺手清理最老的一批即可，不需要额外的后台 timer 拖住进程退出。
 */
import type { Logger, Middleware } from '../../types.ts';
export interface MessageFilterOptions {
    /** 丢弃 `fromBot === true` 的消息，默认开启 */
    skipSelfEcho?: boolean;
    /**
     * 机器人自己的身份（appId / 账号），命中也按自回声丢弃。
     *
     * 兜的是「平台回推自己的消息但没打 user_is_bot」这一种情况（#45）。
     */
    selfIds?: string[];
    /** 去重配置；传 `false` 完全关闭 */
    dedup?: false | {
        /** msgid 保留时长(ms)，默认 5000 */
        windowMs?: number;
        /** 同时跟踪的 msgid 上限，默认 1000 */
        maxSize?: number;
        /** 注入时钟（单测用），默认 Date.now */
        now?: () => number;
    };
    logger?: Logger;
}
export declare function messageFilter(options?: MessageFilterOptions): Middleware;
//# sourceMappingURL=message-filter.d.ts.map
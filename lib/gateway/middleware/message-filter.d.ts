/**
 * 消息过滤中间件 — 丢弃无效 / 重复 / 自回声消息
 *
 * 两件事合在一次处理里（与上游一致）：
 *   1. **自回声**：推推在某些场景下会把机器人自己发出的消息再作为入站事件推回来
 *      （尤其是群聊），不拦住就会自己回复自己，形成死循环。
 *   2. **去重**：事件重投 / 网关重连重叠时同一条消息可能到达两次，重复处理会
 *      让同一轮对话被触发两遍、并重复消耗额度。
 *
 * 去重只留 msgid + 过期时间，用「懒淘汰」而不是定时器：消息量有上限（maxSize），
 * 每次写入时顺手清理最老的一批即可，不需要额外的后台 timer 拖住进程退出。
 */
import type { Logger, Middleware } from '../../types.ts';
export interface MessageFilterOptions {
    /** 丢弃 `fromBot === true` 的消息，默认开启 */
    skipSelfEcho?: boolean;
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
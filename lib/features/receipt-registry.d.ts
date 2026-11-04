/**
 * 表情回执的状态机。
 *
 * 之前的做法是在中间件里 `await next()` 之后直接换表情——但中间件链在
 * 「交给 agent」那一步就返回了，真正的回复是之后才发出去的。于是 ✅ 在机器人
 * 还没说话时就挂上了，看起来像假的。
 *
 * 现在改成：收到消息挂 👀 并在这里登记；真正的回复发出去时（sender 里）把
 * 👀 撤掉换 ✅；出错换 😵；一轮结束什么都没发（判定为不说话）就把 👀 撤掉。
 *
 * 缺一条消息 id 就不登记，不登记就什么都不做——回执永远是可选装饰。
 */
import type { ReplyTarget, TuituiSender } from '../types.ts';
export interface ReceiptEntry {
    bot: TuituiSender;
    target: ReplyTarget;
    msgId: string;
    done: string;
    fail: string;
}
/** 收到消息：登记一个待兑现的回执（同一个 msgid 重复登记以最后一次为准） */
export declare function registerReceipt(entry: ReceiptEntry): void;
/** 有没有这笔待兑现的回执（测试 / 诊断用） */
export declare function hasReceipt(target: ReplyTarget, msgId: string): boolean;
/** 测试用：清空登记表 */
export declare function resetReceipts(): void;
/**
 * 兑现回执。
 *
 * @param outcome done 回复已发出 / fail 处理出错 / none 这一轮不说话
 * @param messageId 指定 msgid（sender 知道自己在回哪条）；省略则按 target 找最近的一条
 */
export declare function settleReceipt(target: ReplyTarget, outcome: 'done' | 'fail' | 'none', messageId?: string): Promise<void>;
//# sourceMappingURL=receipt-registry.d.ts.map
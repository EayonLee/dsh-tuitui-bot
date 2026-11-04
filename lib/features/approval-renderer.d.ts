/**
 * 审批的文本渲染与卡片按钮构建（纯函数，便于单测）。
 *
 * 单次审批：一次只渲染一个审批请求（每个会话同时只有一个 pending 审批）。
 *
 * 推推的审批卡片由 head/body/footer/action 四段组成，点击后靠 modifyInteractive
 * 原地把按钮换成结果文案——平台不会自动把按钮置灰，这一步得自己做。
 */
import type { TuituiInteractiveAction, TuituiOutboundInteractiveMessage } from '@qihoo/tuitui-bot-sdk';
import type { ApprovalRequest } from './approval-channel.ts';
import { type CardTheme } from './button-utils.ts';
/** 审批被点击后落到卡片上的结果文案 */
export type ApprovalResolution = 'allowed-once' | 'rejected' | 'cancelled' | 'timeout';
/**
 * 把审批请求渲染成文本。
 *
 * - withButtons=true：卡片模式，提示点按钮；
 * - withButtons=false：纯文本兜底（interactive.enabled=false 或卡片发送失败），
 *   此时必须列出编号，否则用户无从作答。
 */
export declare function buildApprovalText(request: ApprovalRequest, command?: string, withButtons?: boolean): string;
/**
 * 构建审批按钮（允许一次 / 拒绝），value 携带本审批的 nonce。
 *
 * dsh 审批协议 outcome 是闭合集合（allowed-once/rejected/cancelled/unavailable），
 * 无 allow-always，因此只提供两个按钮；nonce 与 pending 匹配，旧卡片/其它会话的
 * 卡片点击不 settle（#94-3）。
 */
export declare function buildApprovalKeyboard(nonce: string): TuituiInteractiveAction[];
/** 构建审批交互卡片（待决策形态） */
export declare function buildApprovalCard(request: ApprovalRequest, command: string | undefined, options: {
    nonce: string;
    theme?: Partial<CardTheme>;
}): TuituiOutboundInteractiveMessage;
/**
 * 构建已决策卡片：删掉按钮，只留结果。
 *
 * 推推的交互卡片没有自动置灰（visited_label）能力，必须由我们在同一 msgid 上
 * modifyInteractive 重写整张卡片，否则旧按钮还能被重复点击。
 */
export declare function buildApprovalResolvedCard(request: ApprovalRequest, command: string | undefined, resolution: ApprovalResolution, theme?: Partial<CardTheme>): TuituiOutboundInteractiveMessage;
//# sourceMappingURL=approval-renderer.d.ts.map
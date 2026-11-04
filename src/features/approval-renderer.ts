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
import { APPROVAL_OPTIONS } from './answer-parser.ts';
import { buildAction, resolveCardTheme, type CardTheme } from './button-utils.ts';

/** 审批被点击后落到卡片上的结果文案 */
export type ApprovalResolution = 'allowed-once' | 'rejected' | 'cancelled' | 'timeout';

const RESOLUTION_TEXT: Record<ApprovalResolution, string> = {
  'allowed-once': '✅ 已允许执行',
  rejected: '❌ 已拒绝执行',
  cancelled: '⚠️ 审批已取消',
  timeout: '⌛ 审批超时已作废',
};

/**
 * 把审批请求渲染成文本。
 *
 * - withButtons=true：卡片模式，提示点按钮；
 * - withButtons=false：纯文本兜底（interactive.enabled=false 或卡片发送失败），
 *   此时必须列出编号，否则用户无从作答。
 */
export function buildApprovalText(
  request: ApprovalRequest,
  command?: string,
  withButtons = true,
): string {
  const lines: string[] = ['🔐 **执行审批**', ''];
  lines.push(`🔧 工具: ${request.toolName}`);
  if (command) {
    lines.push('');
    lines.push('```');
    lines.push(command);
    lines.push('```');
  }
  if (request.reason) {
    lines.push('');
    lines.push(`📝 ${request.reason}`);
  }
  lines.push('');
  if (withButtons) {
    lines.push('> 👇 点击下方按钮确认是否允许执行');
  } else {
    APPROVAL_OPTIONS.forEach((option, index) => {
      lines.push(`${index + 1}. ${option.label}`);
    });
    lines.push('');
    lines.push('> 💡 回复编号确认（1 同意 / 2 拒绝）');
  }
  return lines.join('\n');
}

/**
 * 构建审批按钮（允许一次 / 拒绝），value 携带本审批的 nonce。
 *
 * dsh 审批协议 outcome 是闭合集合（allowed-once/rejected/cancelled/unavailable），
 * 无 allow-always，因此只提供两个按钮；nonce 与 pending 匹配，旧卡片/其它会话的
 * 卡片点击不 settle（#94-3）。
 */
export function buildApprovalKeyboard(nonce: string): TuituiInteractiveAction[] {
  const [allow, deny] = APPROVAL_OPTIONS;
  const actions: TuituiInteractiveAction[] = [];
  if (allow) {
    actions.push(buildAction({
      name: 'approval-allow',
      text: allow.label,
      value: { t: 'approval', d: 'allow', n: nonce },
    }));
  }
  if (deny) {
    actions.push(buildAction({
      name: 'approval-deny',
      text: deny.label,
      value: { t: 'approval', d: 'deny', n: nonce },
    }));
  }
  return actions;
}

/** 卡片正文：命令回显 + 原因（正文保留完整文本，按钮只承担操作入口） */
function approvalBodyContent(request: ApprovalRequest, command?: string): string {
  const parts: string[] = [];
  if (command) {
    parts.push('```', command, '```');
  }
  if (request.reason) {
    if (parts.length > 0) parts.push('');
    parts.push(`📝 ${request.reason}`);
  }
  return parts.join('\n');
}

/** 构建审批交互卡片（待决策形态） */
export function buildApprovalCard(
  request: ApprovalRequest,
  command: string | undefined,
  options: { nonce: string; theme?: Partial<CardTheme> },
): TuituiOutboundInteractiveMessage {
  const theme = resolveCardTheme(options.theme);
  const content = approvalBodyContent(request, command);
  return {
    head: { text: '🔐 执行审批', bgcolor: theme.headBgColor, tcolor: theme.headTextColor },
    body: {
      title: `🔧 工具: ${request.toolName}`,
      ...(content ? { content } : {}),
    },
    footer: [{ text: '👇 点击下方按钮确认是否允许执行' }],
    action: buildApprovalKeyboard(options.nonce),
  };
}

/**
 * 构建已决策卡片：删掉按钮，只留结果。
 *
 * 推推的交互卡片没有自动置灰（visited_label）能力，必须由我们在同一 msgid 上
 * modifyInteractive 重写整张卡片，否则旧按钮还能被重复点击。
 */
export function buildApprovalResolvedCard(
  request: ApprovalRequest,
  command: string | undefined,
  resolution: ApprovalResolution,
  theme?: Partial<CardTheme>,
): TuituiOutboundInteractiveMessage {
  const resolvedTheme = resolveCardTheme(theme);
  const content = approvalBodyContent(request, command);
  return {
    head: { text: '🔐 执行审批', bgcolor: resolvedTheme.headBgColor, tcolor: resolvedTheme.headTextColor },
    body: {
      title: `🔧 工具: ${request.toolName}`,
      ...(content ? { content } : {}),
    },
    footer: [{ text: RESOLUTION_TEXT[resolution] }],
  };
}

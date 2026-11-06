import { describe, it, expect, vi } from 'vitest';
import type { EventOptions } from '@deepseek-ai/cordis';
import type { TuituiInteractiveAction, TuituiOutboundInteractiveMessage } from '@qihoo/tuitui-bot-sdk';
import {
  ApprovalChannel,
  type ApprovalOutcome,
  type ApprovalRequest,
  type ApprovalSessionRecordLike,
  type ApprovalChannelConfigLike,
  type ApprovalChannelContext,
} from './approval-channel.ts';
import { buildApprovalKeyboard, buildApprovalText } from './approval-renderer.ts';
import type { ChatScope, InboundMessage, Logger, ReplyTarget } from '../types.ts';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

interface SentCard {
  text?: string;
  card?: TuituiOutboundInteractiveMessage;
  /** true = 原地改写（modifyInteractive） */
  updated?: boolean;
  target?: ReplyTarget;
  msgId?: string;
}

/** 推推出站原语的最小实现（卡片优先，文本兜底） */
function createSender(sent: SentCard[], opts?: { failCard?: boolean; failText?: boolean }) {
  return {
    sendMarkdown: vi.fn(async (target: ReplyTarget, content: string) => {
      if (opts?.failText) throw new Error('network down');
      sent.push({ text: content, target });
      return { msgId: `text-${sent.length}` };
    }),
    sendInteractive: vi.fn(async (target: ReplyTarget, card: TuituiOutboundInteractiveMessage) => {
      if (opts?.failCard) throw new Error('card not permitted');
      sent.push({ card, target });
      return { msgId: `card-${sent.length}` };
    }),
    modifyInteractive: vi.fn(async (target: ReplyTarget, msgId: string, card: TuituiOutboundInteractiveMessage) => {
      sent.push({ card, target, msgId, updated: true });
    }),
  };
}

const sessionKey = (scope: ChatScope, peerId: string): string => `tuitui:${scope}:${peerId}`;

/** 默认开放模式（不校验）；allowlist 模式用 makeConfig('allowlist', [...]) */
function makeConfig(
  c2cMode: 'open' | 'allowlist' | 'disabled' = 'open',
  c2cAllow: string[] = [],
  interactive?: { enabled?: boolean; approvalTimeoutMs?: number },
): ApprovalChannelConfigLike {
  return { access: { c2cMode, c2cAllow }, ...(interactive ? { interactive } : {}) };
}

function makeRecord(key: string, scope: ChatScope = 'c2c'): ApprovalSessionRecordLike {
  return { sessionKey: key, scope, replyTarget: { scope, targetId: 'x', msgId: 'm' } };
}

function createManager(opts?: {
  findBySessionId?: (id: string) => ApprovalSessionRecordLike | undefined;
  getSessionRecord?: (scope: ChatScope, peerId: string) => ApprovalSessionRecordLike | undefined;
}) {
  return {
    findBySessionId: opts?.findBySessionId ?? (() => undefined),
    getSessionRecord: opts?.getSessionRecord ?? ((scope: ChatScope, peerId: string) => makeRecord(sessionKey(scope, peerId), scope)),
  };
}

function makeRequest(opts?: {
  id?: string;
  toolName?: string;
  callId?: string;
  reason?: string;
  events?: ReturnType<NonNullable<ApprovalRequest['agent']['session']>['snapshotEvents']>;
  signal?: AbortSignal;
  /** 模拟拿不到 live session 的审批上下文（跨进程/投影后的 Agent）。 */
  noSession?: boolean;
}): ApprovalRequest {
  return {
    agent: opts?.noSession === true
      ? { id: opts?.id ?? 'sess-a' }
      : { id: opts?.id ?? 'sess-a', session: { snapshotEvents: () => opts?.events ?? [] } },
    toolName: opts?.toolName ?? 'bash',
    ...(opts?.callId !== undefined ? { callId: opts.callId } : {}),
    ...(opts?.reason !== undefined ? { reason: opts.reason } : {}),
    ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
  };
}

/** 已发送的最后一张卡片 */
function lastCard(sent: SentCard[]): TuituiOutboundInteractiveMessage {
  const card = sent[sent.length - 1]?.card;
  if (!card) throw new Error('no card sent');
  return card;
}

/** 从卡片里取指定决策按钮的 value（含 nonce） */
function buttonValueOf(sent: SentCard[], d: 'allow' | 'deny'): unknown {
  const actions = lastCard(sent).action ?? [];
  const action = actions.find((item) => (item.value as { d?: string } | undefined)?.d === d);
  if (!action) throw new Error(`button ${d} not found`);
  return action.value;
}

/**
 * 构造 interactive_action 入站消息。
 *
 * 形状与 tuitui/inbound.ts 的 normalizeInteractive 一致：会话定位看 kind/groupId/
 * senderAccount，按钮 value 从 raw.data.action[0].value 取，msgid 就是卡片 id。
 */
function makeInteraction(
  value: unknown,
  peer: { user?: string; group?: string; account?: string },
): InboundMessage {
  const account = peer.account ?? peer.user ?? '';
  const raw = {
    event: 'interactive_action',
    cid: 'evt-1',
    uid: 'uid-1',
    user_account: account,
    user_name: 'tester',
    timestamp: '2026-01-01T00:00:00Z',
    ...(peer.group ? { group_id: peer.group } : {}),
    data: {
      msgid: 'card-1',
      user: { account, uid: 'uid-1' },
      conversation: { type: peer.group ? 'group' : 'single', targeted: peer.group ?? account },
      action: [{ text: 'click', value }],
    },
  };
  return {
    eventType: 'interactive_action',
    kind: peer.group ? 'group' : 'c2c',
    senderId: 'uid-1',
    senderAccount: account,
    senderName: 'tester',
    content: '',
    messageId: 'card-1',
    timestamp: '2026-01-01T00:00:00Z',
    ...(peer.group ? { groupId: peer.group } : {}),
    attachments: [],
    raw,
  };
}

/** 分发载荷（gateway 的 InteractionPayload） */
function payload(message: InboundMessage): { message: InboundMessage; replyTarget: ReplyTarget; bot: never } {
  return { message, replyTarget: { scope: message.kind, targetId: 'x' }, bot: undefined as never };
}

/** 注册 approval/request 监听并捕获 handler，供测试手动触发 */
function installAndCapture(ch: ApprovalChannel): {
  handler: (req: unknown, next: unknown) => unknown;
  options?: EventOptions;
} {
  const captured: {
    handler?: (req: unknown, next: unknown) => unknown;
    options?: EventOptions;
  } = {};
  const ctx: ApprovalChannelContext = {
    on: vi.fn((event: string, handler: (req: unknown, next: unknown) => unknown, options?: EventOptions) => {
      if (event === 'approval/request') {
        captured.handler = handler;
        captured.options = options;
      }
      return () => true;
    }),
  };
  ch.install(ctx);
  return { handler: captured.handler!, ...(captured.options !== undefined ? { options: captured.options } : {}) };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('buildApprovalKeyboard', () => {
  it('builds two mutually-exclusive buttons with type-tagged value', () => {
    const actions: TuituiInteractiveAction[] = buildApprovalKeyboard('n1');
    expect(actions).toHaveLength(2);

    const [allow, deny] = actions;
    expect(allow?.name).toBe('approval-allow');
    expect(allow?.value).toEqual({ t: 'approval', d: 'allow', n: 'n1' });
    expect(deny?.name).toBe('approval-deny');
    expect(deny?.value).toEqual({ t: 'approval', d: 'deny', n: 'n1' });
    // 文案：用户看到的是"允许一次"，没有 allow-always（dsh outcome 是闭合集合）
    expect(allow?.text).toContain('允许');
    expect(deny?.text).toContain('拒绝');
  });
});

describe('buildApprovalText', () => {
  it('renders tool name, gated command and reason', () => {
    const req = makeRequest({ toolName: 'bash', reason: '用户要求列出文件' });
    const text = buildApprovalText(req, 'ls -la');
    expect(text).toContain('bash');
    expect(text).toContain('ls -la');
    expect(text).toContain('用户要求列出文件');
  });

  it('lists numbered options in the plain-text fallback', () => {
    const text = buildApprovalText(makeRequest(), undefined, false);
    expect(text).toContain('1. ✅ 同意');
    expect(text).toContain('2. ❌ 拒绝');
    expect(text).toContain('回复编号确认');
  });
});

describe('ApprovalChannel.install', () => {
  it('发审批卡片期间被 abort：立刻返回 cancelled，不挂到超时（#42）', async () => {
    const sent: SentCard[] = [];
    const controller = new AbortController();
    const sender = createSender(sent);
    const originalSend = sender.sendInteractive;
    sender.sendInteractive = vi.fn(async (...args: Parameters<typeof originalSend>) => {
      controller.abort();
      return originalSend(...args);
    });

    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-a' ? makeRecord(sessionKey('c2c', 'peer-a')) : undefined) }),
      sender,
      makeConfig(),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);
    const outcome = await handler(
      makeRequest({ id: 'sess-a', signal: controller.signal }),
      () => Promise.resolve('unavailable' as ApprovalOutcome),
    );

    expect(outcome).toBe('cancelled');
  });
  it('routes tuitui sessions to park and delegates others to next', async () => {
    const sent: SentCard[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-a' ? makeRecord(sessionKey('c2c', 'peer-a')) : undefined) }),
      createSender(sent),
      makeConfig(),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);

    // 非本插件会话 → 委托 next
    const delegated = await handler(makeRequest({ id: 'sess-web' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    expect(delegated).toBe('unavailable');
    expect(sent).toHaveLength(0);

    // 本插件会话 → park（发卡片 + 挂起）
    const p = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);
    expect(sent).toHaveLength(1);
    expect(lastCard(sent).action).toHaveLength(2);

    // 点击 allow → resolve allowed-once
    expect(await ch.handleInteraction(payload(makeInteraction(buttonValueOf(sent, 'allow'), { user: 'peer-a' })))).toBe(true);
    await expect(p).resolves.toBe('allowed-once');
  });

  it('recovers the gated command from the session log', async () => {
    const sent: SentCard[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-a' ? makeRecord(sessionKey('c2c', 'peer-a')) : undefined) }),
      createSender(sent),
      makeConfig(),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);

    const events = [{ type: 'tool/call', data: { callId: 'c1', arguments: JSON.stringify({ command: 'ls -la' }) } }];
    const p = handler(makeRequest({ id: 'sess-a', callId: 'c1', events }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);
    expect(lastCard(sent).body?.content).toContain('ls -la');

    ch.cancelPending(sessionKey('c2c', 'peer-a'));
    await expect(p).resolves.toBe('cancelled');
  });

  it('registers a global waterfall listener without probing the approval service', () => {
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: () => undefined }),
      createSender([]),
      makeConfig(),
      createLogger(),
    );
    const { handler, options } = installAndCapture(ch);
    expect(handler).toBeTypeOf('function');
    expect(options).toEqual({ global: true, prepend: true });
  });

  it('allowlist 模式：非授权成员点击群审批按钮无效，授权成员放行（#83）', async () => {
    const sent: SentCard[] = [];
    const ch = new ApprovalChannel(
      createManager({
        findBySessionId: (id) => (id === 'sess-a' ? makeRecord(sessionKey('group', 'group-1'), 'group') : undefined),
      }),
      createSender(sent),
      makeConfig('allowlist', ['owner-1']),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);

    const p = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);
    expect(sent).toHaveLength(1);

    // 非授权成员点击 → 拒绝（审批保持挂起）
    const stranger = await ch.handleInteraction(
      payload(makeInteraction(buttonValueOf(sent, 'allow'), { group: 'group-1', account: 'stranger-9' })),
    );
    expect(stranger).toBe(false);

    // 授权成员点击 → 放行
    const owner = await ch.handleInteraction(
      payload(makeInteraction(buttonValueOf(sent, 'allow'), { group: 'group-1', account: 'owner-1' })),
    );
    expect(owner).toBe(true);
    await expect(p).resolves.toBe('allowed-once');
  });

  it('旧卡片（nonce 不匹配）点击不 settle，仅当前审批的 nonce 生效（#94-3）', async () => {
    const sent: SentCard[] = [];
    const ch = new ApprovalChannel(
      createManager({
        findBySessionId: (id) => (id === 'sess-a' ? makeRecord(sessionKey('group', 'group-1'), 'group') : undefined),
      }),
      createSender(sent),
      makeConfig('allowlist', ['owner-1']),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);

    const first = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);
    // 第一张卡片作废（cancel）
    ch.cancelPending(sessionKey('group', 'group-1'));
    await expect(first).resolves.toBe('cancelled');

    // 第二次审批 → 新卡片（新 nonce）
    const second = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);
    expect(sent.filter((s) => s.card !== undefined && s.updated !== true)).toHaveLength(2);

    // 用第一张卡片的 value（旧 nonce）点击 → 拒绝，审批保持挂起
    const firstCard = sent.find((s) => s.card !== undefined && s.updated !== true);
    const staleAllow = (firstCard?.card?.action ?? []).find(
      (item) => (item.value as { d?: string } | undefined)?.d === 'allow',
    )?.value;
    expect(
      await ch.handleInteraction(payload(makeInteraction(staleAllow, { group: 'group-1', account: 'owner-1' }))),
    ).toBe(false);

    // 新卡片 nonce 点击 → 放行
    expect(
      await ch.handleInteraction(payload(makeInteraction(buttonValueOf(sent, 'allow'), { group: 'group-1', account: 'owner-1' }))),
    ).toBe(true);
    await expect(second).resolves.toBe('allowed-once');
  });

  it('allowlist 模式：点击者身份缺失（无账号字段）拒绝（fail-closed）', async () => {
    const sent: SentCard[] = [];
    const ch = new ApprovalChannel(
      createManager({
        findBySessionId: (id) => (id === 'sess-a' ? makeRecord(sessionKey('group', 'group-1'), 'group') : undefined),
      }),
      createSender(sent),
      makeConfig('allowlist', ['owner-1']),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);

    const p = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);

    // 事件不带任何点击者标识 → 拒绝
    const message = makeInteraction(buttonValueOf(sent, 'allow'), { group: 'group-1' });
    expect(await ch.handleInteraction(payload({ ...message, senderAccount: '', senderId: '' }))).toBe(false);

    ch.cancelPending(sessionKey('group', 'group-1'));
    await expect(p).resolves.toBe('cancelled');
  });

  it('allowlist 模式：私聊卡片转发给他人点击无效', async () => {
    const sent: SentCard[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-a' ? makeRecord(sessionKey('c2c', 'peer-a')) : undefined) }),
      createSender(sent),
      makeConfig('allowlist', ['peer-a']),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);

    const p = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);

    // 转发场景：点击者 ≠ 名单成员 → 无效
    expect(await ch.handleInteraction(payload(makeInteraction(buttonValueOf(sent, 'allow'), { user: 'forwarded-user' })))).toBe(false);

    ch.cancelPending(sessionKey('c2c', 'peer-a'));
    await expect(p).resolves.toBe('cancelled');
  });

  it('still sends the prompt when the session log is unavailable', async () => {
    const sent: SentCard[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-a' ? makeRecord(sessionKey('c2c', 'peer-a')) : undefined) }),
      createSender(sent),
      makeConfig(),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);

    const p = handler(makeRequest({ id: 'sess-a', noSession: true }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);
    expect(sent).toHaveLength(1);
    expect(lastCard(sent).body?.title).toContain('bash');

    ch.cancelPending(sessionKey('c2c', 'peer-a'));
    await expect(p).resolves.toBe('cancelled');
  });
});

describe('ApprovalChannel 卡片兜底（推推无 InlineKeyboard）', () => {
  it('interactive.enabled=false：退化为文本 + 编号提示，文本作答 settle 审批', async () => {
    const sent: SentCard[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-a' ? makeRecord(sessionKey('c2c', 'peer-a')) : undefined) }),
      createSender(sent),
      makeConfig('open', [], { enabled: false }),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);

    const p = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.card).toBeUndefined();
    expect(sent[0]?.text).toContain('回复编号确认');

    expect(ch.tryAnswer('c2c', 'peer-a', '1')).toBe(true);
    await expect(p).resolves.toBe('allowed-once');
  });

  it('卡片发送失败时降级为文本，不返回 unavailable', async () => {
    const sent: SentCard[] = [];
    const logger = createLogger();
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-a' ? makeRecord(sessionKey('c2c', 'peer-a')) : undefined) }),
      createSender(sent, { failCard: true }),
      makeConfig('open', [], { enabled: true }),
      logger,
    );
    const { handler } = installAndCapture(ch);

    const p = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain('1. ✅ 同意');

    ch.cancelPending(sessionKey('c2c', 'peer-a'));
    await expect(p).resolves.toBe('cancelled');
  });

  it('文本作答不是审批决策时返回 false（不吞掉普通消息）', async () => {
    const sent: SentCard[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-a' ? makeRecord(sessionKey('c2c', 'peer-a')) : undefined) }),
      createSender(sent),
      makeConfig(),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);

    const p = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);
    expect(ch.tryAnswer('c2c', 'peer-a', '顺便看下磁盘')).toBe(false);

    ch.cancelPending(sessionKey('c2c', 'peer-a'));
    await expect(p).resolves.toBe('cancelled');
  });
});

describe('ApprovalChannel.handleInteraction', () => {
  it('settles deny as rejected, rewrites the card and ignores unknown buttons', async () => {
    const sent: SentCard[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-a' ? makeRecord(sessionKey('c2c', 'peer-a')) : undefined) }),
      createSender(sent),
      makeConfig(),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);

    const p = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);

    // 非审批按钮 → false，不消费
    expect(
      await ch.handleInteraction(payload(makeInteraction({ t: 'question', q: 'x', i: 0 }, { user: 'peer-a' }))),
    ).toBe(false);
    // 拒绝 → rejected
    expect(await ch.handleInteraction(payload(makeInteraction(buttonValueOf(sent, 'deny'), { user: 'peer-a' })))).toBe(true);
    await expect(p).resolves.toBe('rejected');

    // 决策后原地改写卡片：按钮消失、出现结果文案（自动置灰能力平台不给，得自己做）
    const updated = sent[sent.length - 1];
    expect(updated?.updated).toBe(true);
    expect(updated?.msgId).toBe('card-1');
    expect(updated?.card?.action).toBeUndefined();
    expect(updated?.card?.footer?.[0]?.text).toContain('已拒绝');
  });

  it('无 value 的点击（非卡片回调）不消费', async () => {
    const sent: SentCard[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-a' ? makeRecord(sessionKey('c2c', 'peer-a')) : undefined) }),
      createSender(sent),
      makeConfig(),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);
    const p = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);

    const message = makeInteraction(undefined, { user: 'peer-a' });
    expect(await ch.handleInteraction(payload(message))).toBe(false);

    ch.cancelPending(sessionKey('c2c', 'peer-a'));
    await expect(p).resolves.toBe('cancelled');
  });
});

describe('ApprovalChannel.cancelPending', () => {
  it('cancels a pending approval on session eviction', async () => {
    const sent: SentCard[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-a' ? makeRecord(sessionKey('c2c', 'peer-a')) : undefined) }),
      createSender(sent),
      makeConfig(),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);

    const p = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);

    ch.cancelPending(sessionKey('c2c', 'peer-a'));
    await expect(p).resolves.toBe('cancelled');
  });

  it('fails closed as unavailable when both card and text sending fail', async () => {
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-a' ? makeRecord(sessionKey('c2c', 'peer-a')) : undefined) }),
      createSender([], { failCard: true, failText: true }),
      makeConfig(),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);

    await expect(handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome)))
      .resolves.toBe('unavailable');
  });
});

// ── 可靠性：不许静默落空、不许永久悬挂 ──

describe('ApprovalChannel 可靠性', () => {
  it('超时按 cancelled 结算并改写卡片，不会让会话一直等', async () => {
    const sent: SentCard[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: () => makeRecord(sessionKey('c2c', 'peer-a')) }),
      createSender(sent),
      makeConfig('open', [], { enabled: true, approvalTimeoutMs: 30 }),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);
    const p = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);
    expect(sent).toHaveLength(1);

    await expect(p).resolves.toBe('cancelled');
    // 卡片被改写成超时态，且补了一句人话
    const updated = sent.find((item) => item.updated === true);
    expect(updated?.card?.footer?.[0]?.text).toContain('超时');
    expect(sent.some((item) => (item.text ?? '').includes('作废'))).toBe(true);
  });

  it('点击身份字段与入站消息不一致时按 nonce 兜底结算', async () => {
    const sent: SentCard[] = [];
    // getSessionRecord 查不到（模拟回调里 senderAccount 与入站用的是不同字段）
    const ch = new ApprovalChannel(
      createManager({
        findBySessionId: () => makeRecord(sessionKey('c2c', 'peer-a')),
        getSessionRecord: () => undefined,
      }),
      createSender(sent),
      makeConfig(),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);
    const p = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);

    expect(await ch.handleInteraction(payload(makeInteraction(buttonValueOf(sent, 'allow'), { user: 'peer-a' })))).toBe(true);
    await expect(p).resolves.toBe('allowed-once');
  });

  it('别人的 nonce 点击不会替会话主人结算', async () => {
    const sent: SentCard[] = [];
    const ch = new ApprovalChannel(
      createManager({
        findBySessionId: () => makeRecord(sessionKey('c2c', 'peer-a')),
        getSessionRecord: () => undefined,
      }),
      createSender(sent),
      makeConfig(),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);
    const p = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);

    expect(await ch.handleInteraction(payload(makeInteraction(buttonValueOf(sent, 'allow'), { user: 'someone-else' })))).toBe(false);
    // 仍然是挂起状态：主人点一次才结算
    expect(await ch.handleInteraction(payload(makeInteraction(buttonValueOf(sent, 'deny'), { user: 'peer-a' })))).toBe(true);
    await expect(p).resolves.toBe('rejected');
  });

  it('dispose 把该实例上所有 pending 审批按 cancelled 结算', async () => {
    const sent: SentCard[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: () => makeRecord(sessionKey('c2c', 'peer-a')) }),
      createSender(sent),
      makeConfig(),
      createLogger(),
    );
    const { handler } = installAndCapture(ch);
    const p = handler(makeRequest({ id: 'sess-a' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);

    const allowValue = buttonValueOf(sent, 'allow');
    ch.dispose();
    await expect(p).resolves.toBe('cancelled');
    // 已结算：再点同一张卡不会再被认领
    expect(await ch.handleInteraction(payload(makeInteraction(allowValue, { user: 'peer-a' })))).toBe(false);
  });
});

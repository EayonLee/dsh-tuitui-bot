/**
 * 中间件链集成测试 — 验证 setupMiddlewares 的真实编排，而不是单层行为
 *
 * 单测各自绿不代表链子是对的：顺序契约（访问控制 → 历史缓冲 → 触发门控）
 * 一旦被后续改动换位，单测全绿而线上行为全错。这里用真实内核跑完整链，
 * 断言「谁拦下了消息」和「有没有记账」这两个可观察结果。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ImTuituiConfig } from '../config.ts';
import type { SessionManager } from '../session/index.ts';
import type { MiddlewareContext } from '../types.ts';
import { setupMiddlewares } from './middleware-setup.ts';
import { clearGroupHistory, getHistoryStore, historyGroupKey } from '../features/history-store.ts';
import { clearFollowUps, markBotReply } from '../features/followup-store.ts';
import { makeBot, makeCtx, makeMessage } from './middleware/test-utils.ts';
import type { MentionDecision } from './middleware/mention-gate.ts';

const APP_ID = 'app-chain-test';
const GROUP_ID = 'group-chain-1';

/** 链上各层会读到的配置项，其余按默认语义留空 */
function makeConfig(overrides: Record<string, unknown> = {}): ImTuituiConfig {
  return {
    appId: APP_ID,
    appSecret: 'secret',
    textChunkLimit: 4000,
    historyLimit: 10,
    requireMention: true,
    requireMentionInPost: true,
    streaming: false,
    maxQueue: 4,
    processingTimeoutMs: 60_000,
    interactive: { enabled: false },
    reactions: { enabled: false, inGroup: true, ack: '👀', done: '✅', fail: '😵' },
    concurrency: { c2c: 'abort', group: 'queue', post: 'queue' },
    access: {
      c2cMode: 'open', c2cAllow: [], c2cBlock: [],
      groupMode: 'open', groupAllow: [], groupBlock: [],
      postMode: 'open', postAllow: [], postBlock: [],
    },
    ...overrides,
  } as unknown as ImTuituiConfig;
}

/** 只提供链上真正会被调用到的方法 */
function makeManager(): SessionManager {
  return {
    findBySessionId: () => undefined,
    getSessionRecord: () => undefined,
    cancelPending: () => undefined,
  } as unknown as SessionManager;
}

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

function build(config: ImTuituiConfig) {
  return setupMiddlewares({ config, manager: makeManager(), logger, commands: [] });
}

/** 跑完整链，返回被哪一层拦下（undefined = 通过） */
async function runChain(config: ImTuituiConfig, ctx: MiddlewareContext): Promise<string | undefined> {
  await build(config).dispatch(ctx);
  return ctx.skipped;
}

function historyOf(groupId: string): number {
  return getHistoryStore().list(historyGroupKey(APP_ID, groupId), 100).length;
}

describe('中间件链编排（集成）', () => {
  beforeEach(() => {
    clearGroupHistory(APP_ID, GROUP_ID);
    clearFollowUps();
  });

  it('未 @ 的群消息被触发门控拦下，但历史已记账（顺序契约）', async () => {
    const ctx = makeCtx(makeMessage({ groupId: GROUP_ID, content: '大家好', atMe: false }));
    const skipped = await runChain(makeConfig(), ctx);

    expect(skipped).toBe('mention');
    expect(historyOf(GROUP_ID)).toBe(1);
  });

  it('被黑名单拉黑的群：链首就拦下，历史不记账', async () => {
    const config = makeConfig({
      access: {
        c2cMode: 'open', c2cAllow: [], c2cBlock: [],
        groupMode: 'blocklist', groupAllow: [], groupBlock: [GROUP_ID],
        postMode: 'open', postAllow: [], postBlock: [],
      },
    });
    const ctx = makeCtx(makeMessage({ groupId: GROUP_ID, atMe: true }));
    const skipped = await runChain(config, ctx);

    expect(skipped).toBe('access');
    expect(historyOf(GROUP_ID)).toBe(0);
  });

  it('@ 了机器人的群消息通过全链，并带上 mention 决策', async () => {
    const ctx = makeCtx(makeMessage({ groupId: GROUP_ID, atMe: true }));
    const skipped = await runChain(makeConfig(), ctx);

    expect(skipped).toBeUndefined();
    expect((ctx.state.mention as MentionDecision).wasMentioned).toBe(true);
  });

  it('smart 模式：模型没判要说话时沉默（不再有「出现某个词就回」的规则）', async () => {
    const config = makeConfig({ mentionPolicy: 'smart' });
    const ctx = makeCtx(makeMessage({ groupId: GROUP_ID, content: '憨包 今天几号', atMe: false }));

    expect(await runChain(config, ctx)).toBe('mention');
  });

  it('smart 模式：没有模型可判时一律沉默（追问窗口不再兜底）', async () => {
    const config = makeConfig({ mentionPolicy: 'smart' });
    markBotReply('group', GROUP_ID, 'uid-1');
    const ctx = makeCtx(makeMessage({ groupId: GROUP_ID, senderId: 'uid-1', content: '再改一下', atMe: false }));

    expect(await runChain(config, ctx)).toBe('mention');
  });

  it('always 模式：未 @ 的群消息也通过', async () => {
    const ctx = makeCtx(makeMessage({ groupId: GROUP_ID, atMe: false }));
    expect(await runChain(makeConfig({ mentionPolicy: 'always' }), ctx)).toBeUndefined();
  });

  it('未 @ 的群聊命令同样被门控拦下（命令层在门控之后）', async () => {
    const ctx = makeCtx(makeMessage({ groupId: GROUP_ID, content: '/new', atMe: false }));
    expect(await runChain(makeConfig(), ctx)).toBe('mention');
  });

  it('单聊直接通过全链，不进入 @ 门控', async () => {
    const ctx = makeCtx(makeMessage({ kind: 'c2c', eventType: 'single_chat', groupId: undefined, atMe: false }));
    expect(await runChain(makeConfig(), ctx)).toBeUndefined();
  });
});

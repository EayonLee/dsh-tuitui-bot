import { describe, expect, it } from 'vitest';
import { mentionGate } from './mention-gate.ts';
import type { MentionDecision } from './mention-gate.ts';
import { makeCtx, makeMessage, runMiddleware } from './test-utils.ts';

describe('mentionGate', () => {
  it('群聊未 @ 时跳过，并标注 wasMentioned=false', async () => {
    const ctx = makeCtx(makeMessage({ atMe: false }));
    const { reachedNext } = await runMiddleware(mentionGate(), ctx);

    expect(reachedNext).toBe(false);
    expect(ctx.skipped).toBe('mention');
    expect((ctx.state.mention as MentionDecision).wasMentioned).toBe(false);
    expect((ctx.state.mention as MentionDecision).reason).toBe('no_mention');
  });

  it('群聊 @ 了机器人时放行', async () => {
    const ctx = makeCtx(makeMessage({ atMe: true }));
    const { reachedNext } = await runMiddleware(mentionGate(), ctx);

    expect(reachedNext).toBe(true);
    expect(ctx.skipped).toBeUndefined();
    expect((ctx.state.mention as MentionDecision).wasMentioned).toBe(true);
  });

  it('requireMentionInGroup=false 时全量响应群消息', async () => {
    const ctx = makeCtx(makeMessage({ atMe: false }));
    const { reachedNext } = await runMiddleware(mentionGate({ requireMentionInGroup: false }), ctx);

    expect(reachedNext).toBe(true);
    expect((ctx.state.mention as MentionDecision).shouldAnswer).toBe(true);
  });

  it('单聊永远放行', async () => {
    const ctx = makeCtx(makeMessage({ kind: 'c2c', atMe: false }));
    const { reachedNext } = await runMiddleware(mentionGate(), ctx);

    expect(reachedNext).toBe(true);
    expect((ctx.state.mention as MentionDecision).wasMentioned).toBe(true);
  });

  it('帖子走 requireMentionInPost', async () => {
    const post = makeMessage({
      kind: 'post',
      eventType: 'teams_post_create',
      atMe: false,
      post: { teamId: 't1', channelId: 'c1', postId: 'p1', isReply: false },
    });

    const strictCtx = makeCtx({ ...post });
    expect((await runMiddleware(mentionGate({ requireMentionInPost: true }), strictCtx)).reachedNext)
      .toBe(false);
    expect(strictCtx.skipped).toBe('mention');

    const looseCtx = makeCtx({ ...post });
    expect((await runMiddleware(mentionGate({ requireMentionInPost: false }), looseCtx)).reachedNext)
      .toBe(true);
  });

  it('passthrough 只标注不中断链', async () => {
    const ctx = makeCtx(makeMessage({ atMe: false }));
    const { reachedNext } = await runMiddleware(mentionGate({ passthrough: true }), ctx);

    expect(reachedNext).toBe(true);
    expect(ctx.skipped).toBeUndefined();
    expect((ctx.state.mention as MentionDecision).shouldAnswer).toBe(false);
  });

  it('ignoreOtherMentions：@ 了别人但没 @ 机器人 → other_mention', async () => {
    const ctx = makeCtx(makeMessage({
      atMe: false,
      at: [{ isAtAll: false, account: 'lisi', name: '李四' }],
    }));
    const { reachedNext } = await runMiddleware(
      mentionGate({ ignoreOtherMentions: true }),
      ctx,
    );

    expect(reachedNext).toBe(false);
    expect((ctx.state.mention as MentionDecision).reason).toBe('other_mention');
  });

  it('ignoreOtherMentions 在 requireMention=false 时不生效', async () => {
    const ctx = makeCtx(makeMessage({
      atMe: false,
      at: [{ isAtAll: false, account: 'lisi', name: '李四' }],
    }));
    const { reachedNext } = await runMiddleware(
      mentionGate({ requireMentionInGroup: false, ignoreOtherMentions: true }),
      ctx,
    );

    expect(reachedNext).toBe(true);
  });

  it('isImplicitMention 可以放行未 @ 的消息', async () => {
    const ctx = makeCtx(makeMessage({ atMe: false }));
    const { reachedNext } = await runMiddleware(
      mentionGate({ isImplicitMention: () => true }),
      ctx,
    );

    expect(reachedNext).toBe(true);
    expect((ctx.state.mention as MentionDecision).implicit).toBe(true);
  });

  it('resolveConfig 覆盖静态配置', async () => {
    const ctx = makeCtx(makeMessage({ atMe: false }));
    const { reachedNext } = await runMiddleware(
      mentionGate({
        requireMentionInGroup: true,
        resolveConfig: () => ({ requireMentionInGroup: false }),
      }),
      ctx,
    );

    expect(reachedNext).toBe(true);
  });

  it('跳过时触发 onSkip 回调', async () => {
    const decisions: MentionDecision[] = [];
    const ctx = makeCtx(makeMessage({ atMe: false }));
    await runMiddleware(mentionGate({ onSkip: (_ctx, decision) => decisions.push(decision) }), ctx);

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.reason).toBe('no_mention');
  });
});

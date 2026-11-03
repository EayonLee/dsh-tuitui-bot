import { describe, expect, it } from 'vitest';
import { accessPolicy } from './access-policy.ts';
import { makeCtx, makeMessage, runMiddleware } from './test-utils.ts';

const c2cMessage = (account: string, uid = 'uid-x') =>
  makeMessage({ kind: 'c2c', senderAccount: account, senderId: uid });

const postMessage = (teamId: string, channelId: string) =>
  makeMessage({
    kind: 'post',
    eventType: 'teams_post_create',
    post: { teamId, channelId, postId: 'post-1', isReply: false },
  });

describe('accessPolicy', () => {
  it('open 模式全部放行', async () => {
    const ctx = makeCtx(c2cMessage('anyone'));
    expect((await runMiddleware(accessPolicy({ c2c: { mode: 'open' } }), ctx)).reachedNext).toBe(true);
  });

  it('disabled 模式全部拦下', async () => {
    const ctx = makeCtx(c2cMessage('anyone'));
    const { reachedNext } = await runMiddleware(accessPolicy({ c2c: { mode: 'disabled' } }), ctx);

    expect(reachedNext).toBe(false);
    expect(ctx.skipped).toBe('access');
  });

  it('allowlist 为空时 fail-closed', async () => {
    const ctx = makeCtx(c2cMessage('anyone'));
    const { reachedNext } = await runMiddleware(
      accessPolicy({ c2c: { mode: 'allowlist', allow: [] } }),
      ctx,
    );

    expect(reachedNext).toBe(false);
    expect(ctx.skipped).toBe('access');
  });

  it('单聊名单可以匹配域账号或 uid', async () => {
    const policy = accessPolicy({ c2c: { mode: 'allowlist', allow: ['lisi'] } });

    expect((await runMiddleware(policy, makeCtx(c2cMessage('lisi', 'uid-9')))).reachedNext).toBe(true);
    expect((await runMiddleware(policy, makeCtx(c2cMessage('', 'lisi')))).reachedNext).toBe(true);
    expect((await runMiddleware(policy, makeCtx(c2cMessage('wangwu')))).reachedNext).toBe(false);
  });

  it('群聊名单匹配 groupId', async () => {
    const policy = accessPolicy({ group: { mode: 'allowlist', allow: ['group-ok'] } });

    expect((await runMiddleware(policy, makeCtx(makeMessage({ groupId: 'group-ok' })))).reachedNext)
      .toBe(true);

    const blocked = makeCtx(makeMessage({ groupId: 'group-no' }));
    expect((await runMiddleware(policy, blocked)).reachedNext).toBe(false);
    expect(blocked.skipped).toBe('access');
  });

  it('帖子名单匹配 channelId 或 teamId', async () => {
    const policy = accessPolicy({ post: { mode: 'allowlist', allow: ['team-ok', 'channel-ok'] } });

    expect((await runMiddleware(policy, makeCtx(postMessage('team-ok', 'channel-no')))).reachedNext)
      .toBe(true);
    expect((await runMiddleware(policy, makeCtx(postMessage('team-no', 'channel-ok')))).reachedNext)
      .toBe(true);
    expect((await runMiddleware(policy, makeCtx(postMessage('team-no', 'channel-no')))).reachedNext)
      .toBe(false);
  });

  it('deny 规则优先于 open 模式', async () => {
    const policy = accessPolicy({ c2c: { mode: 'open', deny: ['spammer'] } });
    const ctx = makeCtx(c2cMessage('spammer'));

    expect((await runMiddleware(policy, ctx)).reachedNext).toBe(false);
    expect(ctx.skipped).toBe('access');
  });

  it('支持正则与自定义判定', async () => {
    const policy = accessPolicy({
      group: { mode: 'allowlist', allow: [/^team-\d+$/, (ctx) => ctx.message.atMe === true] },
    });

    expect((await runMiddleware(policy, makeCtx(makeMessage({ groupId: 'team-42' })))).reachedNext)
      .toBe(true);
    expect((await runMiddleware(policy, makeCtx(makeMessage({ groupId: 'x', atMe: true })))).reachedNext)
      .toBe(true);
    expect((await runMiddleware(policy, makeCtx(makeMessage({ groupId: 'x' })))).reachedNext)
      .toBe(false);
  });

  it('blocklist 模式：黑名单外全放行，黑名单内拒绝', async () => {
    const policy = accessPolicy({
      group: { mode: 'blocklist', deny: ['g-bad'] },
    });

    expect((await runMiddleware(policy, makeCtx(makeMessage({ groupId: 'g-ok' })))).reachedNext)
      .toBe(true);
    expect((await runMiddleware(policy, makeCtx(makeMessage({ groupId: 'g-bad' })))).reachedNext)
      .toBe(false);
  });

  it('黑名单优先于白名单：同时在两份名单里仍然拒绝', async () => {
    const policy = accessPolicy({
      c2c: { mode: 'allowlist', allow: ['alice'], deny: ['alice'] },
    });

    expect((await runMiddleware(policy, makeCtx(makeMessage({ kind: 'c2c', senderAccount: 'alice' })))).reachedNext)
      .toBe(false);
  });

  it('被拦下时回调 onBlock 并带上原因', async () => {
    const reasons: string[] = [];
    const policy = accessPolicy({
      group: { mode: 'allowlist', allow: ['g1'] },
      onBlock: (_ctx, reason) => reasons.push(reason),
    });

    await runMiddleware(policy, makeCtx(makeMessage({ groupId: 'g2' })));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('not in allowlist');
  });
});

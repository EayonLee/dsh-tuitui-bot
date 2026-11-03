/**
 * 疑似 bug（已用 it.skip 标注并验证过确实失败，未改业务代码）：
 * TuituiStreamSession 在首帧拿不到 msgid 时会逐帧追加发送，
 * 但 complete() 又用 pending 再发一次最后一帧，用户会看到重复内容。
 */
import { describe, expect, it, vi } from 'vitest';
import type { TuituiBotClient } from '@qihoo/tuitui-bot-sdk';
import { TuituiSenderImpl, renderCardAsText, toSdkTarget } from './sender.ts';
import type { Logger, ReplyTarget } from '../types.ts';
import { sendMarkdownChunked } from '../shared/send-helper.ts';

/** 记录一次 SDK 调用，便于断言"调了哪个接口、传了什么参数" */
interface RecordedCall {
  api: string;
  args: any;
}

type Handler = (args: any) => any;

/** 假 SDK 客户端：不碰网络，只记录调用并返回可控响应 */
function createFakeClient(handlers: Record<string, Handler> = {}) {
  const calls: RecordedCall[] = [];
  const invoke = async (api: string, args: unknown): Promise<any> => {
    calls.push({ api, args });
    const handler = handlers[api];
    return handler ? handler(args) : { msgid: `msg-${calls.length}` };
  };

  const client = {
    im: {
      sendText: (args: unknown) => invoke('im.sendText', args),
      modifyText: (args: unknown) => invoke('im.modifyText', args),
      sendInteractive: (args: unknown) => invoke('im.sendInteractive', args),
      modifyInteractive: (args: unknown) => invoke('im.modifyInteractive', args),
      sendFile: (args: unknown) => invoke('im.sendFile', args),
      recall: (args: unknown) => invoke('im.recall', args),
      emojiReaction: (args: unknown) => invoke('im.emojiReaction', args),
    },
    teams: {
      sendPost: (args: unknown) => invoke('teams.sendPost', args),
      editPost: (args: unknown) => invoke('teams.editPost', args),
      sendFile: (args: unknown) => invoke('teams.sendFile', args),
      emojiReaction: (args: unknown) => invoke('teams.emojiReaction', args),
    },
  };

  return { client: client as unknown as TuituiBotClient, calls };
}

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } satisfies Logger;
}

interface SetupOptions {
  handlers?: Record<string, Handler>;
  streaming?: boolean;
  streamIntervalMs?: number;
  textChunkLimit?: number;
}

function setup(over: SetupOptions = {}) {
  const logger = createLogger();
  const { client, calls } = createFakeClient(over.handlers ?? {});
  const sender = new TuituiSenderImpl({
    client,
    logger,
    streaming: over.streaming ?? false,
    streamIntervalMs: over.streamIntervalMs ?? 0,
    textChunkLimit: over.textChunkLimit ?? 4000,
  });
  return { sender, logger, calls };
}

/** 模拟推推接口抛出的完整错误对象（含 endpoint/errcode/trans_id） */
function apiError(message = 'send failed') {
  return Object.assign(new Error(message), {
    endpoint: '/im/send_text',
    status: 500,
    errcode: 1002,
    response: { trans_id: 'trans-9', errmsg: 'server busy' },
  });
}

const c2c: ReplyTarget = { scope: 'c2c', targetId: 'zhangsan' };
const group: ReplyTarget = { scope: 'group', targetId: 'g-1' };
const post: ReplyTarget = { scope: 'post', targetId: 'ch-1', teamId: 't-1', channelId: 'ch-1' };

describe('toSdkTarget', () => {
  it('c2c 域账号走 accounts', () => {
    expect(toSdkTarget({ scope: 'c2c', targetId: 'zhangsan' })).toEqual({ accounts: ['zhangsan'] });
  });

  it('c2c 纯数字走 uids（无域账号时退化为 uid）', () => {
    expect(toSdkTarget({ scope: 'c2c', targetId: '10086' })).toEqual({ uids: ['10086'] });
  });

  it('c2c 带点/下划线的域账号仍走 accounts', () => {
    expect(toSdkTarget({ scope: 'c2c', targetId: 'zhang.san_01' })).toEqual({
      accounts: ['zhang.san_01'],
    });
  });

  it('群聊固定用 groupId，数字也不当 uid', () => {
    expect(toSdkTarget({ scope: 'group', targetId: '998877' })).toEqual({ groupId: '998877' });
  });

  it('post 作用域没有 im 目标，返回 null', () => {
    expect(toSdkTarget({ scope: 'post', targetId: 'ch-1', teamId: 't-1', channelId: 'ch-1' })).toBeNull();
  });
});

describe('sendMarkdown', () => {
  it('c2c 数字目标发到 uids，并返回 msgid', async () => {
    const { sender, calls } = setup();

    const result = await sender.sendMarkdown({ scope: 'c2c', targetId: '10086' }, 'hi');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ api: 'im.sendText' });
    expect(calls[0]?.args).toEqual({ to: { uids: ['10086'] }, text: 'hi' });
    expect(result).toEqual({ msgId: 'msg-1' });
  });

  it('群聊发送带 groupId，@ 列表原样透传', async () => {
    const { sender, calls } = setup();

    await sender.sendMarkdown(group, '早', { at: ['lisi', 'wangwu'] });

    expect(calls[0]?.args).toEqual({
      to: { groupId: 'g-1' },
      text: '早',
      at: ['lisi', 'wangwu'],
    });
  });

  it('at 为空数组时不传 at 字段', async () => {
    const { sender, calls } = setup();

    await sender.sendMarkdown(group, '早', { at: [] });

    expect(calls[0]?.args).not.toHaveProperty('at');
  });

  it('帖子发到 teams.sendPost，parentPostId 映射为 parentId', async () => {
    const { sender, calls } = setup();

    await sender.sendMarkdown(
      { ...post, parentPostId: 'p-0' },
      '回帖内容',
    );

    expect(calls[0]).toEqual({
      api: 'teams.sendPost',
      args: { teamId: 't-1', channelId: 'ch-1', text: '回帖内容', parentId: 'p-0' },
    });
  });

  it('帖子没有 parentPostId 时不带 parentId', async () => {
    const { sender, calls } = setup();

    await sender.sendMarkdown(post, '主帖');

    expect(calls[0]?.args).not.toHaveProperty('parentId');
  });

  it('空串/纯空白直接返回空结果，不调用 SDK', async () => {
    const { sender, calls } = setup();

    expect(await sender.sendMarkdown(c2c, '')).toEqual({});
    expect(await sender.sendMarkdown(c2c, '  \n\t ')).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it('超长文本由调用方切分，这里整条透传不截断', async () => {
    const { sender, calls } = setup({ textChunkLimit: 100 });
    const long = 'x'.repeat(5000);

    await sender.sendMarkdown(c2c, long);

    expect(calls[0]?.args.text).toBe(long);
    expect(calls[0]?.args.text).toHaveLength(5000);
  });

  it('没有 msgId 时不传 referenceMessageId', async () => {
    const { sender, calls } = setup();

    await sender.sendMarkdown(c2c, 'hi');

    expect(calls[0]?.args).not.toHaveProperty('referenceMessageId');
  });

  it('有 msgId 时透传 referenceMessageId 引用回复', async () => {
    const { sender, calls } = setup();

    await sender.sendMarkdown({ ...c2c, msgId: 'm-origin' }, 'hi');

    expect(calls[0]?.args.referenceMessageId).toBe('m-origin');
  });

  it('SDK 抛错时记录完整错误并重抛', async () => {
    const { sender, logger, calls } = setup({
      handlers: { 'im.sendText': () => { throw apiError(); } },
    });

    await expect(sender.sendMarkdown(c2c, 'hi')).rejects.toThrow('send failed');

    expect(calls).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const warnText = String(logger.warn.mock.calls[0]?.[0]);
    expect(warnText).toContain('sendMarkdown failed');
    expect(warnText).toContain('scope=c2c target=zhangsan');
    expect(warnText).toContain('trans_id=trans-9');
    expect(warnText).toContain('errcode=1002');
  });

  it('帖子目标缺 teamId 时抛错且不调用 teams.sendPost', async () => {
    const { sender, logger, calls } = setup();

    await expect(sender.sendMarkdown({ scope: 'post', targetId: 'ch-1' }, 'hi'))
      .rejects.toThrow('post target requires teamId/channelId');
    expect(calls).toHaveLength(0);
    expect(String(logger.warn.mock.calls[0]?.[0])).toContain('post target requires teamId/channelId');
  });
});

describe('长文本切分（sendMarkdownChunked + 真实发送器）', () => {
  it('空串不产生任何发送', async () => {
    const { sender, calls } = setup();

    await sendMarkdownChunked(sender, c2c, '', 100);

    expect(calls).toHaveLength(0);
  });

  it('带代码块与 emoji 的长文本按行切分且无损、不截断字符', async () => {
    const { sender, calls } = setup();
    const code = ['```ts', 'const 表情 = "😀";', 'const 中文 = "推推";', '```'].join('\n');
    const lines = [
      '开头说明 😀😀😀',
      '第一段内容'.repeat(10),
      code,
      '结尾段落 🚀🚀🚀'.repeat(6),
    ];
    const text = lines.join('\n');
    const limit = 60;

    await sendMarkdownChunked(sender, group, text, limit);

    const sent = calls.map((call) => call.args.text as string);
    expect(sent.length).toBeGreaterThan(1);
    // 拼回去必须等于原文：没有截断、没有丢字
    expect(sent.join('\n')).toBe(text);
    // 代码块围栏成对，不被劈开
    expect(sent.join('\n').match(/```/g)).toHaveLength(2);
    // 每个代理对都完整（没有孤立代理项）
    for (const chunk of sent) {
      expect([...chunk].every((ch) => ch !== '\uFFFD')).toBe(true);
      expect(/\uD83D$/.test(chunk)).toBe(false);
    }
    // 每一块都走真实的 im.sendText
    expect(calls.every((call) => call.api === 'im.sendText')).toBe(true);
  });
});

describe('sendInteractive / modifyInteractive', () => {
  const card = {
    head: { text: '需要审批' },
    body: { title: '命令执行', content: 'rm -rf /tmp/x' },
    fields: [{ text: '风险等级' }, { name: '目录', value: '/tmp' }, { name: '忽略', value: { a: 1 } }],
    footer: [{ text: '超时 60s' }, {}],
    action: [{ text: '同意', name: 'approve' }, { name: 'hidden' }, { text: '拒绝', name: 'deny' }],
  };

  it('renderCardAsText 渲染标题/字段/页脚与编号选项', () => {
    expect(renderCardAsText(card)).toBe(
      [
        '**需要审批**',
        '**命令执行**',
        'rm -rf /tmp/x',
        '风险等级',
        '目录：/tmp',
        '超时 60s',
        '',
        '1. 同意',
        '2. 拒绝',
      ].join('\n'),
    );
  });

  it('renderCardAsText 空卡片返回空串且忽略非字符串 value', () => {
    expect(renderCardAsText({})).toBe('');
    expect(renderCardAsText({ fields: [{ name: 'k', value: { nested: true } }] })).toBe('');
  });

  it('c2c 交互卡片原样交给 im.sendInteractive', async () => {
    const { sender, calls } = setup();

    const result = await sender.sendInteractive(c2c, card);

    expect(calls[0]).toEqual({ api: 'im.sendInteractive', args: { to: { accounts: ['zhangsan'] }, interactive: card } });
    expect(result).toEqual({ msgId: 'msg-1' });
  });

  it('帖子不支持卡片，降级为带编号选项的文本帖', async () => {
    const { sender, calls } = setup();

    await sender.sendInteractive(post, card);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.api).toBe('teams.sendPost');
    expect(calls[0]?.args.text).toContain('1. 同意');
    expect(calls[0]?.args.text).toContain('2. 拒绝');
  });

  it('modifyInteractive 在群聊走 im.modifyInteractive', async () => {
    const { sender, calls } = setup();

    await sender.modifyInteractive(group, 'm-9', card);

    expect(calls[0]).toEqual({
      api: 'im.modifyInteractive',
      args: { to: { groupId: 'g-1' }, messageId: 'm-9', interactive: card },
    });
  });

  it('modifyInteractive 在帖子走 teams.editPost 的文本渲染', async () => {
    const { sender, calls } = setup();

    await sender.modifyInteractive(post, 'p-9', card);

    expect(calls[0]).toEqual({
      api: 'teams.editPost',
      args: { teamId: 't-1', channelId: 'ch-1', postId: 'p-9', text: renderCardAsText(card) },
    });
  });

  it('卡片发送失败时记录并重抛', async () => {
    const { sender, logger } = setup({
      handlers: { 'im.sendInteractive': () => { throw apiError('interactive failed'); } },
    });

    await expect(sender.sendInteractive(c2c, card)).rejects.toThrow('interactive failed');
    expect(String(logger.warn.mock.calls[0]?.[0])).toContain('sendInteractive failed');
  });
});

describe('sendImage / sendFile', () => {
  it('图片带说明时先发文本、再发文件', async () => {
    const { sender, calls } = setup();

    const result = await sender.sendImage(c2c, '/tmp/a.png', { caption: '图来了' });

    expect(calls.map((call) => call.api)).toEqual(['im.sendText', 'im.sendFile']);
    expect(calls[0]?.args).toEqual({ to: { accounts: ['zhangsan'] }, text: '图来了' });
    expect(calls[1]?.args).toEqual({ to: { accounts: ['zhangsan'] }, source: '/tmp/a.png' });
    expect(result).toEqual({ msgId: 'msg-2' });
  });

  it('内存字节按 {data, filename, contentType} 归一化上传', async () => {
    const { sender, calls } = setup();
    const data = new Uint8Array([1, 2, 3]);

    await sender.sendImage(group, { data, filename: 'b.png', contentType: 'image/png' }, { filename: 'b.png' });

    expect(calls[0]?.args.source).toEqual({ data, filename: 'b.png', contentType: 'image/png' });
    expect(calls[0]?.args.filename).toBe('b.png');
  });

  it('ArrayBuffer 转成 Uint8Array，未给 contentType 时不下发该字段', async () => {
    const { sender, calls } = setup();
    const buffer = new Uint8Array([7, 8, 9]).buffer;

    await sender.sendFile(group, { data: buffer, filename: 'c.bin' });

    const source = calls[0]?.args.source;
    expect(source.data).toBeInstanceOf(Uint8Array);
    expect(source.data).toEqual(new Uint8Array([7, 8, 9]));
    expect(source).not.toHaveProperty('contentType');
  });

  it('帖子媒体走 teams.sendFile，caption 落到 text 字段', async () => {
    const { sender, calls } = setup();

    await sender.sendFile({ ...post, parentPostId: 'p-0' }, '/tmp/r.pdf', {
      caption: '报告',
      filename: 'r.pdf',
    });

    expect(calls[0]?.api).toBe('teams.sendFile');
    expect(calls[0]?.args).toMatchObject({
      teamId: 't-1',
      channelId: 'ch-1',
      source: '/tmp/r.pdf',
      text: '报告',
      parentId: 'p-0',
    });
  });

  it('媒体发送失败时记录 sendMedia(<kind>) 并重抛', async () => {
    const { sender, logger } = setup({
      handlers: { 'im.sendFile': () => { throw apiError('upload failed'); } },
    });

    await expect(sender.sendFile(c2c, '/tmp/x.pdf')).rejects.toThrow('upload failed');
    expect(String(logger.warn.mock.calls[0]?.[0])).toContain('sendMedia(file) failed');
  });
});

describe('recall / emojiReaction', () => {
  it('群聊撤回走 im.recall', async () => {
    const { sender, calls } = setup();

    await sender.recall(group, 'm-3');

    expect(calls[0]).toEqual({ api: 'im.recall', args: { to: { groupId: 'g-1' }, messageId: 'm-3' } });
  });

  it('帖子撤回无 API，只记 debug 不调用 SDK', async () => {
    const { sender, logger, calls } = setup();

    await expect(sender.recall(post, 'p-3')).resolves.toBeUndefined();

    expect(calls).toHaveLength(0);
    expect(String(logger.debug.mock.calls[0]?.[0])).toContain('recall unsupported for post');
  });

  it('撤回失败时重抛并记录', async () => {
    const { sender, logger } = setup({
      handlers: { 'im.recall': () => { throw apiError('recall failed'); } },
    });

    await expect(sender.recall(group, 'm-3')).rejects.toThrow('recall failed');
    expect(String(logger.warn.mock.calls[0]?.[0])).toContain('recall failed');
  });

  it('群聊 emoji 表情取消标记为 true 时下发 cancel', async () => {
    const { sender, calls } = setup();

    await sender.emojiReaction(group, 'm-4', '👍', true);

    expect(calls[0]).toEqual({
      api: 'im.emojiReaction',
      args: { to: { groupId: 'g-1' }, messageId: 'm-4', emoji: '👍', cancel: true },
    });
  });

  it('不取消时不传 cancel 字段', async () => {
    const { sender, calls } = setup();

    await sender.emojiReaction(c2c, 'm-4', '👍');

    expect(calls[0]?.args).not.toHaveProperty('cancel');
  });

  it('帖子 emoji 走 teams.emojiReaction', async () => {
    const { sender, calls } = setup();

    await sender.emojiReaction(post, 'p-4', '🎉');

    expect(calls[0]?.api).toBe('teams.emojiReaction');
    expect(calls[0]?.args).toEqual({
      teamId: 't-1',
      channelId: 'ch-1',
      postId: 'p-4',
      emoji: '🎉',
    });
  });

  it('emoji 失败不影响主流程，只记 debug', async () => {
    const { sender, logger } = setup({
      handlers: { 'im.emojiReaction': () => { throw apiError('emoji boom'); } },
    });

    await expect(sender.emojiReaction(group, 'm-4', '👍')).resolves.toBeUndefined();
    expect(String(logger.debug.mock.calls[0]?.[0])).toContain('emojiReaction failed');
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('openStream / 流式会话', () => {
  it('关闭流式时返回 null', () => {
    const { sender } = setup({ streaming: false });

    expect(sender.openStream(group)).toBeNull();
  });

  it('c2c uid 目标不支持原地编辑，返回 null 走静态发送', () => {
    const { sender } = setup({ streaming: true });

    expect(sender.openStream({ scope: 'c2c', targetId: '10086' })).toBeNull();
  });

  it('帖子目标不完整时返回 null', () => {
    const { sender } = setup({ streaming: true });

    expect(sender.openStream({ scope: 'post', targetId: 'ch-1' })).toBeNull();
  });

  it('群聊首帧发送拿 msgid，节流窗口内不刷新，complete 时原地编辑最后一帧', async () => {
    const { sender, calls } = setup({ streaming: true, streamIntervalMs: 60_000 });
    const session = sender.openStream(group);
    expect(session).not.toBeNull();

    await session!.update('第一帧');
    expect(calls.map((call) => call.api)).toEqual(['im.sendText']);
    expect(calls[0]?.args).toMatchObject({ to: { groupId: 'g-1' }, text: '第一帧' });

    await session!.update('第二帧');
    expect(calls).toHaveLength(1);

    await session!.complete();
    expect(calls.map((call) => call.api)).toEqual(['im.sendText', 'im.modifyText']);
    expect(calls[1]?.args).toEqual({
      to: { groupId: 'g-1' },
      messageId: 'msg-1',
      text: '第二帧',
      withoutPush: true,
    });
  });

  it('帖子流式：首帧发帖，后续编辑帖', async () => {
    const { sender, calls } = setup({ streaming: true, streamIntervalMs: 0 });
    const session = sender.openStream(post);

    await session!.update('帖子首帧');
    await session!.update('帖子更新');
    await session!.complete();

    expect(calls.map((call) => call.api)).toEqual(['teams.sendPost', 'teams.editPost', 'teams.editPost']);
    expect(calls[1]?.args).toEqual({
      teamId: 't-1',
      channelId: 'ch-1',
      postId: 'msg-1',
      text: '帖子更新',
    });
  });

  it('complete 后 update 不再发送', async () => {
    const { sender, calls } = setup({ streaming: true, streamIntervalMs: 0 });
    const session = sender.openStream(group);

    await session!.update('一');
    await session!.complete();
    await session!.update('二');

    expect(calls).toHaveLength(2);
  });

  it('空内容不产生 modifyText 调用', async () => {
    const { sender, calls } = setup({ streaming: true, streamIntervalMs: 0 });

    await sender.editStream(group, 'm-1', '   ');

    expect(calls).toHaveLength(0);
  });

  it('editStream 失败重抛并记录，流式会话内部吞掉刷新错误', async () => {
    const { sender, logger } = setup({
      handlers: { 'im.modifyText': () => { throw apiError('modify failed'); } },
    });

    await expect(
      sender.editStream(group, 'm-1', '新内容', true),
    ).rejects.toThrow('modify failed');
    expect(String(logger.warn.mock.calls[0]?.[0])).toContain('modifyText failed');

    const stream = setup({
      streaming: true,
      streamIntervalMs: 0,
      handlers: { 'im.modifyText': () => { throw apiError('modify failed'); } },
    });
    const session = stream.sender.openStream(group)!;
    await session.update('一');
    await session.update('二');
    await expect(session.complete()).resolves.toBeUndefined();
  });

  it('拿不到 msgid 时逐帧追加发送（只发增量，不重复整段）', async () => {
    const { sender, calls } = setup({
      streaming: true,
      streamIntervalMs: 0,
      handlers: { 'im.sendText': () => ({}) },
    });
    const session = sender.openStream({ scope: 'c2c', targetId: 'zhangsan' })!;

    await session.update('甲');
    await session.update('甲乙');

    expect(calls).toHaveLength(2);
    expect(calls[0]?.args.text).toBe('甲');
    // 降级模式是「追加」：第二帧只发新增的「乙」，不是再发一遍「甲乙」
    expect(calls[1]?.args.text).toBe('乙');
  });

  it('降级模式下内容被重置（新 attempt）时发整段', async () => {
    const { sender, calls } = setup({
      streaming: true,
      streamIntervalMs: 0,
      handlers: { 'im.sendText': () => ({}) },
    });
    const session = sender.openStream({ scope: 'c2c', targetId: 'zhangsan' })!;

    await session.update('旧的回答');
    await session.update('新答案');
    await session.complete();

    expect(calls.map((call) => call.args.text)).toEqual(['旧的回答', '新答案']);
  });

  // 疑似 bug：seed 拿不到 msgid 时 update 已逐帧发过最后一帧，
  // complete() 又用 pending 再发一次，用户会看到重复的最后一段。
  // 若确认是设计（宁可重复不可丢字），删除此条并在实现里注释说明。
  it('complete 不应重发最后一帧（疑似 bug：重复发送）', async () => {
    const { sender, calls } = setup({
      streaming: true,
      streamIntervalMs: 0,
      handlers: { 'im.sendText': () => ({}) },
    });
    const session = sender.openStream({ scope: 'c2c', targetId: 'zhangsan' })!;

    await session.update('唯一一帧');
    await session.complete();

    expect(calls).toHaveLength(1);
  });
});

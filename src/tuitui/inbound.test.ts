/**
 * 疑似 bug（均已用 it.skip 标注并验证过确实失败，未改业务代码）：
 * 1. normalizeMessage 用 `data.group_id ?? body.group_id` 取值，空串不会回落事件体，
 *    导致 data.group_id='' 且 body.group_id 有值时 groupId 直接丢失。
 * 2. normalizeAttachments 注释写"按 url 去重"，但去重 key 优先 fileId；
 *    影子字段带 fileId、原始 images 同 url 时会重复产出两条附件。
 */
import { describe, expect, it, vi } from 'vitest';
import { TuituiBotClient, type TuituiEventBody } from '@qihoo/tuitui-bot-sdk';
import { getInteractiveAction } from '../features/button-utils.ts';
import { classifyMime, isMessageEvent, normalizeEvent } from './inbound.ts';

/** 构造一个基础事件体（推推保证这些字段存在，缺字段用例再单独覆盖） */
function makeBody(over: Record<string, unknown> = {}): TuituiEventBody {
  return {
    bot_name: 'dsh-bot',
    event: 'single_chat',
    cid: 'cid-1',
    uid: 'u-1',
    user_account: 'zhangsan',
    user_name: '张三',
    user_dept_path: '公司-部门',
    timestamp: '1700000000',
    ...over,
  } as unknown as TuituiEventBody;
}

function makeRender(): ReturnType<typeof vi.fn> {
  return vi.fn((data: any) => (typeof data?.rendered === 'string' ? data.rendered : ''));
}

const options = (render = makeRender()) => ({ render });

describe('normalizeEvent：入口分派', () => {
  it('不认识的事件返回 null', () => {
    expect(normalizeEvent(makeBody({ event: 'group_created' }), options())).toBeNull();
  });

  it('event 不是字符串时也返回 null，不抛错', () => {
    expect(normalizeEvent(makeBody({ event: undefined }), options())).toBeNull();
  });

  it('isMessageEvent 只认三种消息类事件', () => {
    expect(isMessageEvent('single_chat')).toBe(true);
    expect(isMessageEvent('group_chat')).toBe(true);
    expect(isMessageEvent('teams_post_create')).toBe(true);
    expect(isMessageEvent('interactive_action')).toBe(false);
    expect(isMessageEvent('group_created')).toBe(false);
  });
});

describe('normalizeEvent：single_chat', () => {
  it('基础字段映射到 InboundMessage，raw 保留事件体引用', () => {
    const render = makeRender();
    const body = makeBody({
      data: { msg_type: 'text', text: '你好', msgid: 'm-1' },
    });

    const message = normalizeEvent(body, { render })!;

    expect(message.kind).toBe('c2c');
    expect(message.eventType).toBe('single_chat');
    expect(message.senderId).toBe('u-1');
    expect(message.senderAccount).toBe('zhangsan');
    expect(message.senderName).toBe('张三');
    expect(message.content).toBe('你好');
    expect(message.messageId).toBe('m-1');
    expect(message.timestamp).toBe('1700000000');
    expect(message.attachments).toEqual([]);
    expect(message.raw).toBe(body);
    // text 已存在时不需要 SDK 渲染器兜底
    expect(render).not.toHaveBeenCalled();
    expect(message).not.toHaveProperty('groupId');
    expect(message).not.toHaveProperty('atMe');
    expect(message).not.toHaveProperty('fromBot');
  });

  it('缺发送者字段时归一化为空串，不抛错', () => {
    const body = makeBody({
      uid: undefined,
      user_account: undefined,
      user_name: undefined,
      data: { msg_type: 'text', text: 'hi', msgid: 'm-1' },
    });

    const message = normalizeEvent(body, options())!;

    expect(message.senderId).toBe('');
    expect(message.senderAccount).toBe('');
    expect(message.senderName).toBe('');
  });

  it('msgid 缺失时退化到 cid，两者都空时用 事件名:时间戳', () => {
    const withCid = makeBody({ cid: 'cid-7', data: { msg_type: 'text', text: 'hi', msgid: '' } });
    expect(normalizeEvent(withCid, options())!.messageId).toBe('cid-7');

    const empty = makeBody({ cid: '', data: { msg_type: 'text', text: 'hi' } });
    expect(normalizeEvent(empty, options())!.messageId).toBe('single_chat:1700000000');
  });

  it('没有 text 时用 SDK 渲染器结果，并去掉首尾空白', () => {
    const render = makeRender();
    render.mockReturnValue('  图片里的文字  ');
    const body = makeBody({ data: { msg_type: 'image', images: ['http://i/1.png'] } });

    const message = normalizeEvent(body, { render })!;

    expect(message.content).toBe('图片里的文字');
    expect(render).toHaveBeenCalledWith(body.data);
  });

  it('text 只有空白时仍然走渲染器', () => {
    const render = makeRender();
    render.mockReturnValue('渲染结果');
    const body = makeBody({ data: { msg_type: 'markdown', text: '   ' } });

    expect(normalizeEvent(body, { render })!.content).toBe('渲染结果');
    expect(render).toHaveBeenCalled();
  });

  it('渲染器抛错时正文降级为可读占位，不影响其余字段', () => {
    const render = vi.fn(() => {
      throw new Error('render failed');
    });
    const body = makeBody({ data: { msg_type: 'unknown_type' } });

    const message = normalizeEvent(body, { render })!;

    // issue #18：空串会让"读不了"和"没人说话"无法区分，统一给占位
    expect(message.content).toBe('[未支持的消息类型: unknown_type]');
    expect(message.senderName).toBe('张三');
  });

  it('user_is_bot=true 时标记 fromBot', () => {
    const body = makeBody({
      user_is_bot: true,
      data: { msg_type: 'text', text: 'bot echo', msgid: 'm-1' },
    });

    expect(normalizeEvent(body, options())!.fromBot).toBe(true);
  });
});

describe('normalizeEvent：group_chat', () => {
  it('群字段与 @ 列表完整映射', () => {
    const body = makeBody({
      event: 'group_chat',
      data: {
        msg_type: 'text',
        text: '@机器人 在吗',
        msgid: 'm-2',
        group_id: 'g-1',
        group_name: '项目群',
        at_me: true,
        at: [
          { is_at_all: false, cid: 'bot-account', uid: 'u-bot', name: '机器人' },
          { is_at_all: true },
        ],
      },
    });

    const message = normalizeEvent(body, options())!;

    expect(message.kind).toBe('group');
    expect(message.groupId).toBe('g-1');
    expect(message.groupName).toBe('项目群');
    expect(message.atMe).toBe(true);
    expect(message.at).toEqual([
      { isAtAll: false, account: 'bot-account', uid: 'u-bot', name: '机器人' },
      { isAtAll: true },
    ]);
  });

  it('缺 group_id 时不给 groupId，kind 仍为 group', () => {
    const body = makeBody({
      event: 'group_chat',
      data: { msg_type: 'text', text: 'hi', msgid: 'm-2', group_id: '' },
    });

    const message = normalizeEvent(body, options())!;

    expect(message.kind).toBe('group');
    expect(message).not.toHaveProperty('groupId');
    expect(message).not.toHaveProperty('groupName');
  });

  it('data 里没有 group_id 时回落到事件体 group_id', () => {
    const body = makeBody({
      event: 'group_chat',
      group_id: 'g-body',
      group_name: '事件体群名',
      data: { msg_type: 'text', text: 'hi', msgid: 'm-2' },
    });

    const message = normalizeEvent(body, options())!;

    expect(message.groupId).toBe('g-body');
    expect(message.groupName).toBe('事件体群名');
  });

  // 疑似 bug：`data.group_id ?? body.group_id` 只处理 null/undefined，
  // data.group_id 为空串时既不回落 body.group_id，也不会输出 groupId。
  // 建议改成 `firstString(data.group_id, body.group_id)`。
  it('data.group_id 为空串时应回落到事件体 group_id（疑似 bug）', () => {
    const body = makeBody({
      event: 'group_chat',
      group_id: 'g-body',
      data: { msg_type: 'text', text: 'hi', msgid: 'm-2', group_id: '' },
    });

    expect(normalizeEvent(body, options())!.groupId).toBe('g-body');
  });

  it('at 数组为空 / at_me 不是布尔时都不塞字段', () => {
    const body = makeBody({
      event: 'group_chat',
      data: { msg_type: 'text', text: 'hi', msgid: 'm-2', group_id: 'g-1', at: [], at_me: 'true' },
    });

    const message = normalizeEvent(body, options())!;

    expect(message).not.toHaveProperty('at');
    expect(message).not.toHaveProperty('atMe');
  });
});

describe('normalizeEvent：附件归一化', () => {
  it('images 字符串数组转图片附件并按 url 去重', () => {
    const body = makeBody({
      data: { msg_type: 'image', images: ['http://i/1.png', 'http://i/1.png', 'http://i/2.png'] },
    });

    const message = normalizeEvent(body, options())!;

    expect(message.attachments).toEqual([
      { kind: 'image', url: 'http://i/1.png', mimeType: 'image/*' },
      { kind: 'image', url: 'http://i/2.png', mimeType: 'image/*' },
    ]);
  });

  it('file 附件按 mime_type 分类并保留文件名/file_id', () => {
    const body = makeBody({
      data: {
        msg_type: 'file',
        file: { url: 'http://f/r.pdf', mime_type: 'application/pdf', name: 'r.pdf', file_id: 'fid-1' },
      },
    });

    expect(normalizeEvent(body, options())!.attachments).toEqual([
      { kind: 'file', url: 'http://f/r.pdf', filename: 'r.pdf', fileId: 'fid-1', mimeType: 'application/pdf' },
    ]);
  });

  it('语音附件带 ASR 转写，视频单独成类', () => {
    const body = makeBody({
      data: { msg_type: 'voice', voice: 'http://v/1.amr', asr_refer_text: '语音转写' },
    });

    expect(normalizeEvent(body, options())!.attachments).toEqual([
      { kind: 'voice', url: 'http://v/1.amr', mimeType: 'audio/*', asrText: '语音转写' },
    ]);

    const video = makeBody({ data: { msg_type: 'video', video: 'http://v/2.mp4' } });
    expect(normalizeEvent(video, options())!.attachments).toEqual([
      { kind: 'video', url: 'http://v/2.mp4', mimeType: 'video/*' },
    ]);
  });

  it('媒体缺 url 时直接跳过，不产生空附件', () => {
    const body = makeBody({
      data: {
        msg_type: 'file',
        images: ['', '   '],
        file: { name: 'only-name.bin' },
        voice: '',
        video: '',
      },
    });

    expect(normalizeEvent(body, options())!.attachments).toEqual([]);
  });

  it('_tuitui_media 影子字段优先，保留 mime/文件名/fileId', () => {
    const body = makeBody({
      data: {
        msg_type: 'image',
        _tuitui_media: [
          { mimeType: 'image/webp', url: 'http://i/x.webp', name: 'x.webp', fileId: 'fid-2' },
        ],
      },
    });

    expect(normalizeEvent(body, options())!.attachments).toEqual([
      { kind: 'image', url: 'http://i/x.webp', mimeType: 'image/webp', filename: 'x.webp', fileId: 'fid-2' },
    ]);
  });

  it('影子字段里的脏数据（无 url / 非对象）被忽略', () => {
    const body = makeBody({
      data: {
        msg_type: 'image',
        _tuitui_media: [null, 'str', { mimeType: 'image/png' }, { mime_type: 'image/gif', url: 'http://i/g.gif' }],
      },
    });

    expect(normalizeEvent(body, options())!.attachments).toEqual([
      { kind: 'image', url: 'http://i/g.gif', mimeType: 'image/gif' },
    ]);
  });

  // 疑似 bug：注释写"按 url 去重"，但去重 key 优先 fileId，
  // 影子字段带 fileId + 原始 images 同 url 时会重复出两条。
  it('影子字段带 fileId 时与原始 images 同 url 不应重复（疑似 bug）', () => {
    const body = makeBody({
      data: {
        msg_type: 'image',
        _tuitui_media: [{ mimeType: 'image/png', url: 'http://i/same.png', fileId: 'fid-3' }],
        images: ['http://i/same.png'],
      },
    });

    expect(normalizeEvent(body, options())!.attachments).toHaveLength(1);
  });
});

describe('normalizeEvent：引用消息', () => {
  it('ref 的文本/发送者/附件/共享帖都保留', () => {
    const body = makeBody({
      data: {
        msg_type: 'text',
        text: '这条引用了别人',
        msgid: 'm-3',
        ref: {
          text: '被引用的原文',
          user_name: '李四',
          user_account: 'lisi',
          shared_post: 'sp-1',
          images: ['http://i/q.png'],
        },
      },
    });

    expect(normalizeEvent(body, options())!.reference).toEqual({
      text: '被引用的原文',
      senderName: '李四',
      senderAccount: 'lisi',
      attachments: [{ kind: 'image', url: 'http://i/q.png', mimeType: 'image/*' }],
      sharedPostId: 'sp-1',
    });
  });

  it('ref 没有 text 时用渲染器兜底', () => {
    const render = vi.fn(() => '渲染出的引用');
    const ref = { user_name: '李四' };
    const body = makeBody({ data: { msg_type: 'text', text: '正文', ref } });

    const message = normalizeEvent(body, { render })!;

    expect(message.reference?.text).toBe('渲染出的引用');
    expect(render).toHaveBeenCalledWith(ref);
  });

  it('ref 渲染器抛错时省略 text，但引用对象仍然存在', () => {
    const render = vi.fn(() => { throw new Error('boom'); });
    const body = makeBody({ data: { msg_type: 'text', text: '正文', ref: { user_name: '李四' } } });

    const reference = normalizeEvent(body, { render })!.reference!;

    expect(reference).not.toHaveProperty('text');
    expect(reference.senderName).toBe('李四');
    expect(reference.attachments).toEqual([]);
  });

  it('ref 不是对象时视为没有引用', () => {
    const body = makeBody({ data: { msg_type: 'text', text: '正文', ref: 'abc' } });

    expect(normalizeEvent(body, options())!).not.toHaveProperty('reference');
  });
});

describe('normalizeEvent：teams_post_create', () => {
  const fullPost = {
    team_id: 't-1',
    team_name: '研发团队',
    team_desc: '',
    channel_id: 'ch-1',
    channel_name: '公告频道',
    channel_desc: '',
    is_reply: true,
    parent_id: 'p-0',
    post_id: 'p-9',
    content: '帖子正文',
    rich_text_type: 'markdown',
    rich_text: '原始富文本',
    at_me: true,
    at: [
      { type: 'all' },
      { type: 'tag', tag: { id: 'tag-1', name: '值班' } },
      { type: 'user', user: { account: 'lisi', uid: 'u-9', name: '李四' } },
    ],
    images: ['http://i/1.png'],
    files: [{ name: 'f.pdf', url: 'http://f/1.pdf', file_id: 'fid-9' }],
  };

  it('帖子定位、@ 列表与附件完整映射', () => {
    const body = makeBody({ event: 'teams_post_create', data: fullPost });

    const message = normalizeEvent(body, options())!;

    expect(message.kind).toBe('post');
    expect(message.messageId).toBe('p-9');
    expect(message.content).toBe('帖子正文');
    expect(message.atMe).toBe(true);
    expect(message.post).toEqual({
      teamId: 't-1',
      channelId: 'ch-1',
      postId: 'p-9',
      parentId: 'p-0',
      teamName: '研发团队',
      channelName: '公告频道',
      isReply: true,
    });
    expect(message.at).toEqual([
      { isAtAll: true },
      { isAtAll: false },
      { isAtAll: false, account: 'lisi', uid: 'u-9', name: '李四' },
    ]);
    expect(message.attachments).toEqual([
      { kind: 'image', url: 'http://i/1.png', mimeType: 'image/*' },
      { kind: 'file', url: 'http://f/1.pdf', filename: 'f.pdf', fileId: 'fid-9' },
    ]);
  });

  it('content 缺失时用 rich_text 兜底', () => {
    const body = makeBody({
      event: 'teams_post_create',
      data: { ...fullPost, content: '', rich_text: '富文本兜底' },
    });

    expect(normalizeEvent(body, options())!.content).toBe('富文本兜底');
  });

  it('post_id 缺失时 messageId 退化到 cid，且不带 parentId / isReply=false', () => {
    const body = makeBody({
      event: 'teams_post_create',
      cid: 'cid-post',
      data: { ...fullPost, post_id: '', parent_id: undefined, is_reply: undefined },
    });

    const message = normalizeEvent(body, options())!;

    expect(message.messageId).toBe('cid-post');
    expect(message.post!.isReply).toBe(false);
    expect(message.post).not.toHaveProperty('parentId');
  });

  it('帖子没有 team/channel 时 post 字段为空串（交由调用方判空）', () => {
    const body = makeBody({
      event: 'teams_post_create',
      data: { post_id: 'p-1', content: 'hi' },
    });

    expect(normalizeEvent(body, options())!.post).toEqual({
      teamId: '',
      channelId: '',
      postId: 'p-1',
      isReply: false,
    });
  });
});

describe('normalizeEvent：interactive_action', () => {
  it('卡片回调：用户优先 data.user、按钮值写入 content、群会话带 groupId', () => {
    const body = makeBody({
      event: 'interactive_action',
      group_id: 'g-1',
      data: {
        msgid: 'm-2',
        user: { uid: 'u2', account: 'lisi', name: '李四' },
        conversation: { type: 'group' },
        action: [{ text: '同意' }, { value: { t: 'approval' } }, { text: '拒绝', value: 'deny' }],
      },
    });

    const message = normalizeEvent(body, options())!;

    expect(message.eventType).toBe('interactive_action');
    expect(message.kind).toBe('group');
    expect(message.groupId).toBe('g-1');
    expect(message.senderId).toBe('u2');
    expect(message.senderAccount).toBe('lisi');
    expect(message.senderName).toBe('李四');
    expect(message.messageId).toBe('m-2');
    // 按钮 text 优先于 value：有 text 时 value 不参与拼接
    expect(message.content).toBe('同意 {"t":"approval"} 拒绝');
    expect(message.attachments).toEqual([]);
  });

  it('无 user 时回落 sender 与事件体；无 action 时 content 用发送者昵称', () => {
    const body = makeBody({
      event: 'interactive_action',
      cid: 'cid-ia',
      user_name: '王五',
      data: {
        sender: { uid: 'u3', account: 'wangwu' },
      },
    });

    const message = normalizeEvent(body, options())!;

    expect(message.kind).toBe('c2c');
    expect(message.senderId).toBe('u3');
    expect(message.senderAccount).toBe('wangwu');
    expect(message.senderName).toBe('王五');
    expect(message.messageId).toBe('cid-ia');
    expect(message.content).toBe('王五');
    expect(message).not.toHaveProperty('groupId');
  });

  it('无 action、无名字时 content 为空串且不抛错', () => {
    const body = makeBody({
      event: 'interactive_action',
      user_name: '',
      data: { msgid: 'm-3' },
    });

    const message = normalizeEvent(body, options())!;

    expect(message.content).toBe('');
    expect(message.senderId).toBe('u-1');
    expect(message.messageId).toBe('m-3');
  });
});

describe('classifyMime', () => {
  it('按 MIME 前缀分类，未知/空值归为 file', () => {
    expect(classifyMime('image/png')).toBe('image');
    expect(classifyMime('IMAGE/JPEG')).toBe('image');
    expect(classifyMime('audio/amr')).toBe('voice');
    expect(classifyMime('video/mp4')).toBe('video');
    expect(classifyMime('application/pdf')).toBe('file');
    expect(classifyMime('text/plain')).toBe('file');
    expect(classifyMime(undefined)).toBe('file');
    expect(classifyMime('')).toBe('file');
  });
});

describe('normalizeEvent：interactive_action（线上真实回调形状）', () => {
  // 2026-11-04 线上抓包：卡片信息包在 body.data.message 里，
  // 而 SDK 的 TuituiInteractiveCallbackMessage 类型是平铺的。
  const rawEvent = {
    cid: '7652669648797797',
    uid: '7652738368427950',
    user_account: 'zhangsan',
    user_name: '张三',
    is_me: false,
    user_is_bot: false,
    timestamp: '1793758777',
    event: 'interactive_action',
    bot_name: '小助手',
    data: {
      message: {
        msgid: '7704135227344309517',
        user: { uid: '7652738368427950', cid: '7652669648797797', name: '张三', account: 'zhangsan' },
        sender: { uid: '7652738368553025', cid: '7652669648797797', name: '小助手', account: '' },
        conversation: { type: 'single', targeted: '7652738368553025' },
        appid: '7652669649120958',
        id: '',
        value: '',
        fields: [],
        action: [{ name: 'probe', text: '点我', value: { t: 'probe' }, type: '' }],
      },
    },
  };

  it('必须下钻 body.data.message：msgid 与点击者都不能丢', () => {
    const message = normalizeEvent(rawEvent as never, options())!;
    expect(message.eventType).toBe('interactive_action');
    expect(message.kind).toBe('c2c');
    expect(message.messageId).toBe('7704135227344309517');
    expect(message.senderAccount).toBe('zhangsan');
  });

  it('按钮 value 能被 getInteractiveAction 解出来（点击能否结算的命门）', () => {
    const click = getInteractiveAction(normalizeEvent(rawEvent as never, options())!);
    expect(click).toBeDefined();
    expect(click!.targetId).toBe('zhangsan');
    expect(click!.value).toEqual({ t: 'probe' });
  });
});

describe('未知消息类型与 SDK 渲染分支（issue #18）', () => {
  // 真的调 SDK：merged / card 的正文是 SDK renderBaseMessage 拼的，
  // 用假渲染器测等于自己测自己。SDK 哪天删了分支，这里会先红。
  // 只借它的 renderMessageBody：纯函数，不建连、不发请求
  const sdk = new TuituiBotClient({ appId: 'test', appSecret: 'test' });
  const sdkOptions = (onUnsupported?: (info: unknown) => void) => ({
    render: (data: unknown) => sdk.event.renderMessageBody(data),
    ...(onUnsupported === undefined ? {} : { onUnsupported }),
  });

  it('msg_type=page 且没有 text：正文给可读占位，并回调一次', () => {
    const onUnsupported = vi.fn();
    const message = normalizeEvent(
      makeBody({
        data: { msg_type: 'page', msgid: 'm-page', page: { title: '周报', content: '正文' } },
      }),
      sdkOptions(onUnsupported),
    )!;

    expect(message.content).toBe('[未支持的消息类型: page]');
    expect(onUnsupported).toHaveBeenCalledTimes(1);
    expect(onUnsupported).toHaveBeenCalledWith({ msgType: 'page', messageId: 'm-page', scene: 'c2c' });
  });

  it('群聊里认不出来时，回调带 scene=group', () => {
    const onUnsupported = vi.fn();
    normalizeEvent(
      makeBody({
        event: 'group_chat',
        data: { msg_type: 'some_new_type', msgid: 'm-new', group_id: 'g-1' },
      }),
      sdkOptions(onUnsupported),
    );

    expect(onUnsupported).toHaveBeenCalledWith({
      msgType: 'some_new_type',
      messageId: 'm-new',
      scene: 'group',
    });
  });

  it('msg_type 缺失时占位写「未知」，不留空串', () => {
    const message = normalizeEvent(makeBody({ data: { msgid: 'm-none' } }), sdkOptions())!;
    expect(message.content).toBe('[未支持的消息类型: 未知]');
  });

  it('渲染器抛错也走占位，不把异常抛给中间件', () => {
    const onUnsupported = vi.fn();
    const message = normalizeEvent(
      makeBody({ data: { msg_type: 'weird', msgid: 'm-x' } }),
      {
        render: () => {
          throw new Error('boom');
        },
        onUnsupported,
      },
    )!;

    expect(message.content).toBe('[未支持的消息类型: weird]');
    expect(onUnsupported).toHaveBeenCalledTimes(1);
  });

  it('没给 onUnsupported 时也不炸（纯函数照样可用）', () => {
    const message = normalizeEvent(makeBody({ data: { msg_type: 'page', msgid: 'm-p2' } }), sdkOptions())!;
    expect(message.content).toBe('[未支持的消息类型: page]');
  });

  it('正常文本不会被误判，也不触发回调', () => {
    const onUnsupported = vi.fn();
    const message = normalizeEvent(
      makeBody({ data: { msg_type: 'text', text: '普通消息', msgid: 'm-t' } }),
      sdkOptions(onUnsupported),
    )!;

    expect(message.content).toBe('普通消息');
    expect(onUnsupported).not.toHaveBeenCalled();
  });

  it('合并转发：锁住 SDK 的 [合并转发：…] 分支，正文含发言人与内容', () => {
    const message = normalizeEvent(
      makeBody({
        event: 'group_chat',
        data: {
          msg_type: 'merged',
          msgid: 'm-merged',
          group_id: 'g-1',
          merged: {
            source: '群聊记录',
            msgs: [
              { msg_type: 'text', text: '第一句', user_name: '张三', user_account: 'zhangsan', timestamp: '1700000000' },
              { msg_type: 'text', text: '第二句', user_name: '李四', user_account: 'lisi' },
            ],
          },
        },
      }),
      sdkOptions(),
    )!;

    expect(message.content).toContain('[合并转发：群聊记录]');
    expect(message.content).toContain('发言人: 张三 (zhangsan)');
    expect(message.content).toContain('第一句');
    expect(message.content).toContain('发言人: 李四');
    expect(message.content).toContain('第二句');
  });

  it('合并转发：source 缺失时用「聊天记录」兜底', () => {
    const message = normalizeEvent(
      makeBody({
        data: {
          msg_type: 'merged',
          msgid: 'm-merged2',
          merged: { msgs: [{ msg_type: 'text', text: '只有一句', user_account: 'zhaoliu' }] },
        },
      }),
      sdkOptions(),
    )!;

    expect(message.content).toContain('[合并转发：聊天记录]');
    expect(message.content).toContain('只有一句');
  });

  it('名片：锁住 SDK 的 [名片] 分支，正文含姓名与账号', () => {
    const message = normalizeEvent(
      makeBody({
        data: { msg_type: 'card', msgid: 'm-card', card: { name: '王五', account: 'wangwu' } },
      }),
      sdkOptions(),
    )!;

    expect(message.content).toContain('[名片]');
    expect(message.content).toContain('姓名: 王五');
    expect(message.content).toContain('推推账号: wangwu');
  });

  it('名片字段缺失时也渲染出可读内容，不退化成占位', () => {
    const message = normalizeEvent(
      makeBody({ data: { msg_type: 'card', msgid: 'm-card2', card: {} } }),
      sdkOptions(),
    )!;

    expect(message.content).toContain('[名片]');
    expect(message.content).not.toContain('未支持的消息类型');
  });
});


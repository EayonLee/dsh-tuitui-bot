import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleInbound, resetMergeBuffers } from './inbound.ts';
import type { SessionManager } from '../session/index.ts';
import type { ImTuituiConfig } from '../config.ts';
import type {
  InboundAttachment,
  InboundMessage,
  Logger,
  MiddlewareContext,
  MiddlewareState,
  ReplyTarget,
  TuituiSender,
} from '../types.ts';

// 历史清理由 features/history-store 承担：断言调用即可，不依赖其真实存储
vi.mock('../features/history-store.ts', () => ({ clearGroupHistory: vi.fn() }));
import { clearGroupHistory } from '../features/history-store.ts';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const config = {
  appId: 'app-1',
  concurrency: { c2c: 'abort', group: 'queue', post: 'queue' },
} as unknown as ImTuituiConfig;

function createMessage(over: Partial<InboundMessage> = {}): InboundMessage {
  return {
    eventType: 'single_chat',
    kind: 'c2c',
    senderId: 'u-1',
    senderAccount: 'zhangsan',
    senderName: '张三',
    content: 'hi',
    messageId: 'm-1',
    timestamp: '',
    attachments: [],
    raw: {},
    ...over,
  };
}

function createCtx(
  message: InboundMessage,
  state: MiddlewareState = {},
  replyTarget?: ReplyTarget,
): MiddlewareContext {
  const bot = { sendMarkdown: vi.fn().mockResolvedValue({}) } as unknown as TuituiSender;
  return {
    message,
    state,
    replyTarget: replyTarget ?? { scope: message.kind, targetId: 'peer-1', msgId: message.messageId },
    bot,
    skip: () => {},
    skipped: undefined,
  };
}

interface FakeRecord {
  agent: {
    followup: ReturnType<typeof vi.fn>;
    whenIdle: ReturnType<typeof vi.fn>;
    status: string;
    cancel: ReturnType<typeof vi.fn>;
  };
}

function createManager(over?: { fails?: boolean; busy?: boolean }): { manager: SessionManager; record: FakeRecord; getOrCreate: ReturnType<typeof vi.fn> } {
  const record: FakeRecord = {
    agent: {
      followup: vi.fn(),
      whenIdle: vi.fn().mockResolvedValue(undefined),
      status: over?.busy === true ? 'running' : 'idle',
      cancel: vi.fn(),
    },
  };
  const getOrCreate = over?.fails === true
    ? vi.fn().mockRejectedValue(new Error('boom'))
    : vi.fn().mockResolvedValue(record);
  return { manager: { getOrCreate } as unknown as SessionManager, record, getOrCreate };
}

/** 取出 followup 收到的 UserMessage 的文本内容 */
function followedText(record: FakeRecord): string {
  const message = record.agent.followup.mock.calls[0]?.[0] as { content?: Array<{ type: string; text?: string }> };
  return (message.content ?? []).map((block) => block.text ?? '').join('');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleInbound: 并发策略在 turn 这一层生效', () => {
  it('单聊配 abort 且上一轮在飞：先 cancel 再 followup', async () => {
    const { manager, record, getOrCreate } = createManager({ busy: true });
    await handleInbound(createCtx(createMessage()), manager, config, logger);
    expect(getOrCreate).toHaveBeenCalled();
    expect(record.agent.cancel).toHaveBeenCalledWith({ kind: 'user' });
    expect(record.agent.followup).toHaveBeenCalled();
    // 顺序：cancel 必须在 followup 之前
    const cancelOrder = record.agent.cancel.mock.invocationCallOrder[0];
    const followOrder = record.agent.followup.mock.invocationCallOrder[0];
    expect(cancelOrder).toBeLessThan(followOrder);
  });

  it('群聊配 queue 且上一轮在飞：不取消，照常排队', async () => {
    const { manager, record } = createManager({ busy: true });
    await handleInbound(createCtx(createMessage({ kind: 'group', groupId: 'g-1' })), manager, config, logger);
    expect(record.agent.cancel).not.toHaveBeenCalled();
    expect(record.agent.followup).toHaveBeenCalled();
  });

  it('配 drop 且忙：直接丢弃，不 followup', async () => {
    const dropConfig = {
      appId: 'app-1',
      concurrency: { c2c: 'drop', group: 'queue', post: 'queue' },
    } as unknown as ImTuituiConfig;
    const { manager, record } = createManager({ busy: true });
    await handleInbound(createCtx(createMessage()), manager, dropConfig, logger);
    expect(record.agent.followup).not.toHaveBeenCalled();
  });

  it('merge 且忙：攒着，等这一轮完了一次性合并投递', async () => {
    resetMergeBuffers();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { manager, record } = createManager({ busy: true });
    record.agent.whenIdle.mockImplementation(() => gate);
    const mergeConfig = {
      appId: 'app-1',
      concurrency: { c2c: 'merge', group: 'queue', post: 'queue' },
    } as unknown as ImTuituiConfig;

    const first = handleInbound(createCtx(createMessage({ messageId: 'm-1', content: '第一句' })), manager, mergeConfig, logger);
    const second = handleInbound(createCtx(createMessage({ messageId: 'm-2', content: '第二句' })), manager, mergeConfig, logger);
    // 忙的时候一条都不该投
    await new Promise((r) => setTimeout(r, 0));
    expect(record.agent.followup).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second]);
    // 两条攒成一条投出去
    expect(record.agent.followup).toHaveBeenCalledTimes(1);
  });

  it('空闲时不取消任何东西', async () => {
    const { manager, record } = createManager();
    await handleInbound(createCtx(createMessage()), manager, config, logger);
    expect(record.agent.cancel).not.toHaveBeenCalled();
    expect(record.agent.followup).toHaveBeenCalled();
  });
});

describe('handleInbound: 会话流转', () => {
  it('单聊纯文本：getOrCreate → followup → whenIdle，且不加发送者标签', async () => {
    const { manager, record, getOrCreate } = createManager();
    const ctx = createCtx(createMessage());

    await handleInbound(ctx, manager, config, logger);

    expect(getOrCreate).toHaveBeenCalledWith('c2c', 'zhangsan', 'u-1', ctx.replyTarget);
    expect(record.agent.followup).toHaveBeenCalledTimes(1);
    expect(record.agent.whenIdle).toHaveBeenCalledTimes(1);
    expect(followedText(record)).toBe('hi');
  });

  it('会话创建失败：用 ctx.bot 兜底回复，不 followup', async () => {
    const { manager } = createManager({ fails: true });
    const ctx = createCtx(createMessage());

    await handleInbound(ctx, manager, config, logger);

    expect(ctx.bot.sendMarkdown).toHaveBeenCalledWith(ctx.replyTarget, expect.stringContaining('异常'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ERROR creating session'));
  });

  it('空消息（无文本/附件/语音、非 @）直接跳过', async () => {
    const { manager, getOrCreate } = createManager();
    const ctx = createCtx(createMessage({ content: '   ' }));

    await handleInbound(ctx, manager, config, logger);

    expect(getOrCreate).not.toHaveBeenCalled();
  });
});

describe('handleInbound: 内容组装', () => {
  it('群聊：发送者标签 [昵称 (域账号)] + @ 标记', async () => {
    const { manager, record } = createManager();
    const ctx = createCtx(
      createMessage({ kind: 'group', groupId: 'g-1', content: '你好' }),
      { mention: { wasMentioned: true } },
    );

    await handleInbound(ctx, manager, config, logger);

    const text = followedText(record);
    expect(text).toContain('[张三 (zhangsan)] 你好 (@you)');
    expect(clearGroupHistory).toHaveBeenCalledWith('app-1', 'g-1');
  });

  it('群聊未 @ 时也保留文本，但清历史用 groupId', async () => {
    const { manager, record } = createManager();
    const ctx = createCtx(createMessage({ kind: 'group', groupId: 'g-2', content: '旁听' }));

    await handleInbound(ctx, manager, config, logger);

    expect(followedText(record)).toContain('[张三 (zhangsan)] 旁听');
  });

  it('群聊带历史 envelope：历史在正文之前', async () => {
    const { manager, record } = createManager();
    const ctx = createCtx(
      createMessage({ kind: 'group', groupId: 'g-3', content: '继续' }),
      {
        mention: { wasMentioned: true },
        history: [
          { senderId: 'u-2', senderName: '李四', content: '第一条', timestamp: 1, messageId: 'h1' },
        ],
      },
    );

    await handleInbound(ctx, manager, config, logger);

    const text = followedText(record);
    expect(text).toContain('[Chat history begins]');
    expect(text).toContain('[李四 (u-2)] 第一条');
    expect(text.indexOf('[李四 (u-2)]')).toBeLessThan(text.indexOf('[张三 (zhangsan)]'));
  });

  it('团队帖子：标签含频道名，回复后按 team/channel 清历史', async () => {
    const { manager, record } = createManager();
    const ctx = createCtx(
      createMessage({
        kind: 'post',
        content: '看下这个',
        post: {
          teamId: 'team-1',
          channelId: 'ch-1',
          postId: 'p-1',
          channelName: '鱼塘',
          isReply: false,
        },
      }),
      { mention: { wasMentioned: true } },
      { scope: 'post', targetId: 'ch-1', channelId: 'ch-1', teamId: 'team-1', postId: 'p-1' },
    );

    await handleInbound(ctx, manager, config, logger);

    expect(followedText(record)).toContain('[张三 (zhangsan) · 鱼塘] 看下这个');
    expect(clearGroupHistory).toHaveBeenCalledWith('app-1', 'team-1/ch-1');
  });

  it('引用消息块包在 [Quoted message] 之间', async () => {
    const { manager, record } = createManager();
    const ctx = createCtx(createMessage(), { quote: { text: '原文内容' } });

    await handleInbound(ctx, manager, config, logger);

    const text = followedText(record);
    expect(text).toContain('[Quoted message begins]\n原文内容\n[Quoted message ends]');
  });

  it('语音转录进正文（ASR 兜底路径）', async () => {
    const { manager, record } = createManager();
    const voice: InboundAttachment = {
      kind: 'voice',
      mimeType: 'audio/mpeg',
      asrText: '今天天气不错',
      url: 'https://x/voice.mp3',
    };
    const ctx = createCtx(createMessage({ content: '', attachments: [voice] }));

    await handleInbound(ctx, manager, config, logger);

    expect(followedText(record)).toContain('[Voice message] 今天天气不错');
  });

  it('媒体元数据层带本地路径（图片已下载）', async () => {
    const { manager, record } = createManager();
    const ctx = createCtx(
      createMessage({
        content: '看图',
        attachments: [{ kind: 'image', mimeType: 'image/png', filename: 'a.png', url: 'https://x/a.png' }],
      }),
      { downloadedFiles: [{ filename: 'a.png', kind: 'image', localPath: '/media/a.png', bytes: 3 }] },
    );

    await handleInbound(ctx, manager, config, logger);

    const text = followedText(record);
    expect(text).toContain('- Image: /media/a.png');
    expect(text).toContain('[图片]');
  });

  it('图片下载失败时回退为 URL', async () => {
    const { manager, record } = createManager();
    const ctx = createCtx(
      createMessage({
        content: '看图',
        attachments: [{ kind: 'image', mimeType: 'image/png', filename: 'b.png', url: 'https://x/b.png' }],
      }),
    );

    await handleInbound(ctx, manager, config, logger);

    expect(followedText(record)).toContain('- Image: https://x/b.png');
  });

  it('引用消息的附件单独成块', async () => {
    const { manager, record } = createManager();
    const ctx = createCtx(
      createMessage({
        content: '这个文件',
        reference: {
          text: '附件如下',
          attachments: [{ kind: 'file', mimeType: 'application/pdf', filename: 'r.pdf', url: 'https://x/r.pdf', size: 1024 }],
        },
      }),
      { downloadedQuoteFiles: [{ filename: 'r.pdf', kind: 'file', localPath: '/media/r.pdf' }] },
    );

    await handleInbound(ctx, manager, config, logger);

    const text = followedText(record);
    expect(text).toContain('[Reference attachments]');
    expect(text).toContain('File: /media/r.pdf');
  });
});

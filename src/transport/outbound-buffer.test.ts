import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutboundBuffer } from './outbound-buffer.ts';
import type { OutboundSenderLike } from './outbound-buffer.ts';
import type { SessionRecord } from '../session/index.ts';
import type { Logger, ReplyTarget, StreamSessionLike } from '../types.ts';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createSession(): StreamSessionLike {
  return { update: vi.fn().mockResolvedValue(undefined), complete: vi.fn().mockResolvedValue(undefined) };
}

function createBot(openStreamImpl?: () => StreamSessionLike | null): OutboundSenderLike {
  return {
    sendMarkdown: vi.fn().mockResolvedValue(undefined),
    openStream: vi.fn(openStreamImpl ?? (() => createSession())),
  };
}

function createRecord(target: ReplyTarget): SessionRecord {
  return {
    sessionKey: 'k',
    sessionId: 's1',
    replyTarget: target,
    scope: target.scope,
    peerId: target.targetId,
    senderId: 'sender',
    lastActivity: 0,
    agent: {},
    handle: {},
  } as unknown as SessionRecord;
}

const c2cTarget: ReplyTarget = { scope: 'c2c', targetId: 'user1', msgId: 'msg1' };

describe('OutboundBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('单段发送失败会重试，成功后不再发失败提示（#38）', async () => {
    const bot = createBot(() => null); // openStream 拿不到 msgid → 走静态发送
    const send = bot.sendMarkdown as unknown as ReturnType<typeof vi.fn>;
    send.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(undefined);
    const logger = createLogger();
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, logger, true);

    buffer.append('一段话');
    const flushed = buffer.flush();
    await vi.advanceTimersByTimeAsync(1000);
    await flushed;

    expect(send).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalled();
    // 成功路径没有失败提示
    expect(send.mock.calls.some((call) => String(call[1]).includes('没能发出去'))).toBe(false);
  });

  it('重试耗尽后告知用户，而不是只留一行日志（#38）', async () => {
    const bot = createBot(() => null);
    const send = bot.sendMarkdown as unknown as ReturnType<typeof vi.fn>;
    send.mockRejectedValue(new Error('429 too many requests'));
    const logger = createLogger();
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, logger, true);

    buffer.append('一段话');
    const flushed = buffer.flush();
    await vi.advanceTimersByTimeAsync(5000);
    await flushed;

    // 首次 + 2 次重试 = 3 次，最后一次是失败提示
    expect(send).toHaveBeenCalledTimes(4);
    expect(String(send.mock.calls[3]?.[1])).toContain('没能发出去');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('1/1 段回复发送失败'));
    expect(buffer.text).toBe('');
  });

  it('多段时只重试失败的那一段，已成功的不重发（#38）', async () => {
    const bot = createBot(() => null);
    const send = bot.sendMarkdown as unknown as ReturnType<typeof vi.fn>;
    send
      .mockResolvedValueOnce(undefined)      // 第一段成功
      .mockRejectedValueOnce(new Error('x')) // 第二段失败
      .mockResolvedValueOnce(undefined);     // 重试成功
    const logger = createLogger();
    // limit 很小，逼出多段
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 10, logger, true);

    buffer.append('第一段内容很长很长 第二段内容同样很长很长');
    const flushed = buffer.flush();
    await vi.advanceTimersByTimeAsync(2000);
    await flushed;

    const sentTexts = send.mock.calls.map((call) => String(call[1]));
    expect(sentTexts.some((text) => text.includes('没能发出去'))).toBe(false);
    // 第一段只发了一次（没有因为第二段失败被重发）
    const firstChunk = sentTexts[0];
    expect(sentTexts.filter((text) => text === firstChunk)).toHaveLength(1);
  });

  it('流式开启：append + flush → openStream + update + complete', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    buffer.append('hello');
    await buffer.flush();

    expect(bot.openStream).toHaveBeenCalledTimes(1);
    expect(session.update).toHaveBeenCalledWith('hello');
    expect(session.complete).toHaveBeenCalledTimes(1);
    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('流式关闭：append + flush → 静态 sendMarkdown', async () => {
    const bot = createBot();
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), false);

    buffer.append('hello');
    await buffer.flush();

    expect(bot.openStream).not.toHaveBeenCalled();
    expect(bot.sendMarkdown).toHaveBeenCalledWith(c2cTarget, 'hello');
  });

  it('流式开启但 openStream 抛错 → 降级静态 sendMarkdown', async () => {
    const bot = createBot(() => {
      throw new Error('open failed');
    });
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    buffer.append('hello');
    await vi.advanceTimersByTimeAsync(200);
    await buffer.flush();

    // 流式从未成功发送 → 降级静态
    expect(bot.sendMarkdown).toHaveBeenCalledWith(c2cTarget, 'hello');
  });

  it('流式开启但 openStream 返回 null（无 msgid）→ 降级静态 sendMarkdown', async () => {
    const bot = createBot(() => null);
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    buffer.append('hello');
    await vi.advanceTimersByTimeAsync(200);
    await buffer.flush();

    expect(bot.sendMarkdown).toHaveBeenCalledWith(c2cTarget, 'hello');
  });

  it('超过 textChunkLimit 的静态发送按 Markdown 边界切成多块', async () => {
    const bot = createBot();
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 10, createLogger(), false);

    buffer.append(['aaaa', 'bbbb', 'cccc'].join('\n'));
    await buffer.flush();

    expect(bot.sendMarkdown).toHaveBeenCalledTimes(2);
  });

  it('cancel → abort 关闭会话', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    buffer.append('hello');
    await vi.advanceTimersByTimeAsync(200);
    buffer.cancel();
    await vi.runAllTimersAsync();

    expect(session.complete).toHaveBeenCalledTimes(1);
  });

  it('空白内容 flush 不发任何消息', async () => {
    const bot = createBot();
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), false);

    buffer.append('   \n ');
    await buffer.flush();

    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('reset 清空累积文本并保留流式会话', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    buffer.append('old');
    await vi.advanceTimersByTimeAsync(200);
    expect(session.update).toHaveBeenCalledWith('old');

    buffer.reset();
    expect(buffer.text).toBe('');

    buffer.append('new');
    await buffer.flush();

    expect(bot.openStream).toHaveBeenCalledTimes(1); // 会话复用
    expect(session.update).toHaveBeenNthCalledWith(2, 'new'); // 全量替换
    expect(session.complete).toHaveBeenCalledTimes(1);
    expect(bot.sendMarkdown).not.toHaveBeenCalled(); // 不降级静态
  });
});

import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeliverablesDeliverer } from './deliverables.ts';
import type { SessionRecord } from '../session/index.ts';
import type { ImTuituiConfig } from '../config.ts';
import type { Logger, TuituiSender } from '../types.ts';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function createSender(): TuituiSender {
  return {
    sendMarkdown: vi.fn().mockResolvedValue({}),
    openStream: vi.fn(),
    sendInteractive: vi.fn().mockResolvedValue({}),
    modifyInteractive: vi.fn().mockResolvedValue(undefined),
    sendImage: vi.fn().mockResolvedValue({ msgId: 'm1' }),
    sendFile: vi.fn().mockResolvedValue({ msgId: 'm2' }),
    recall: vi.fn().mockResolvedValue(undefined),
    emojiReaction: vi.fn().mockResolvedValue(undefined),
  } as unknown as TuituiSender;
}

function createConfig(cwd: string): ImTuituiConfig {
  return {
    cwd,
    textChunkLimit: 4500,
    sendFile: { restrictPaths: true, extraRoots: [], sendPresentedFiles: true, maxFiles: 4 },
  } as unknown as ImTuituiConfig;
}

function createRecord(): SessionRecord {
  return {
    sessionKey: 'k',
    sessionId: 's',
    replyTarget: { scope: 'c2c', targetId: 'u' },
  } as unknown as SessionRecord;
}

/** 交付物投递：推推合并了文本/媒体发送器，因此两个构造参数传同一个对象 */
function createDeliverer(sender: TuituiSender, cwd: string): DeliverablesDeliverer {
  return new DeliverablesDeliverer(sender, sender, createConfig(cwd), logger);
}

describe('DeliverablesDeliverer', () => {
  it('存在的文件按扩展名分发发送（图片走 sendImage，其余走 sendFile）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-tuitui-dlv-'));
    const png = join(dir, 'a.png');
    const md = join(dir, 'b.md');
    await writeFile(png, 'x');
    await writeFile(md, 'y');

    const sender = createSender();
    const deliverer = createDeliverer(sender, dir);

    await deliverer.deliver(createRecord(), [{ path: png }, { path: md, description: '文档' }]);

    expect(sender.sendImage).toHaveBeenCalledTimes(1);
    expect(sender.sendFile).toHaveBeenCalledTimes(1);
    expect(sender.sendMarkdown).not.toHaveBeenCalled(); // 全部送达，无需降级提示
  });

  it('缺失文件降级为文字提示，不阻断其余文件', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-tuitui-dlv-'));
    const ok = join(dir, 'ok.txt');
    await writeFile(ok, 'x');

    const sender = createSender();
    const deliverer = createDeliverer(sender, dir);

    await deliverer.deliver(createRecord(), [{ path: ok }, { path: join(dir, 'gone.txt') }]);

    expect(sender.sendFile).toHaveBeenCalledTimes(1); // 存在的那个已发送
    expect(sender.sendMarkdown).toHaveBeenCalledTimes(1);
    const text = (sender.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(text).toContain('未能直接发送');
    expect(text).toContain('gone.txt');
  });

  it('白名单外的路径直接进未送达清单，不调用发送器', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-tuitui-dlv-'));
    const outside = await mkdtemp(join(tmpdir(), 'dsh-tuitui-outside-'));
    const outsideFile = join(outside, 'secret.txt');
    await writeFile(outsideFile, 'x');

    const sender = createSender();
    const deliverer = createDeliverer(sender, dir);

    await deliverer.deliver(createRecord(), [{ path: outsideFile }]);

    expect(sender.sendFile).not.toHaveBeenCalled();
    const text = (sender.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(text).toContain('路径不在允许范围');
  });

  it('maxFiles 截断单轮投递数量，超限文件进未送达提示', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-tuitui-dlv-'));
    const files = await Promise.all(['a', 'b', 'c'].map(async (n) => {
      const p = join(dir, `${n}.txt`);
      await writeFile(p, n);
      return { path: p };
    }));

    const sender = createSender();
    const config = createConfig(dir);
    (config as { sendFile: { maxFiles: number } }).sendFile.maxFiles = 2;
    const deliverer = new DeliverablesDeliverer(sender, sender, config, logger);

    await deliverer.deliver(createRecord(), files);

    expect(sender.sendFile).toHaveBeenCalledTimes(2);
    const text = (sender.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(text).toContain('超出单轮投递上限');
    expect(text).toContain('c.txt');
  });

  it('相对路径按 agent 工作目录解析（历史声明兜底）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-tuitui-dlv-'));
    await writeFile(join(dir, 'rel.md'), 'y');

    const sender = createSender();
    const deliverer = createDeliverer(sender, dir);

    await deliverer.deliver(createRecord(), [{ path: 'rel.md' }]);

    expect(sender.sendFile).toHaveBeenCalledTimes(1);
    expect(sender.sendMarkdown).not.toHaveBeenCalled();
  });
});

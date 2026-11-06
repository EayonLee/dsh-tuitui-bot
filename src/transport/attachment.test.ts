import { afterAll, afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, extname } from 'node:path';
import * as dns from 'node:dns';
import { MEDIA_DIR } from '../shared/dirs.ts';
import { downloadMessageMedia, downloadMediaAttachments, imageExtension, correctImageExt } from './attachment.ts';
import type { InboundAttachment, Logger, MiddlewareContext } from '../types.ts';
import type { ImTuituiConfig } from '../config.ts';

// 下载目录指向临时目录：避免测试污染真实 ~/.dsh-tuitui/media
vi.mock('../shared/dirs.ts', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { MEDIA_DIR: mkdtempSync(join(tmpdir(), 'dsh-tuitui-attachment-')) };
});

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const gif = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex');
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');

const media = { enabled: true, maxMB: 1, ttlHours: 24 };

/** 构造一个只带媒体的入站附件 */
function att(over: Partial<InboundAttachment> = {}): InboundAttachment {
  return {
    kind: 'image',
    mimeType: 'image/png',
    url: 'https://example.com/image',
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['8.8.8.8']);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  rmSync(MEDIA_DIR, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(MEDIA_DIR, { recursive: true, force: true });
});

describe('downloadMediaAttachments', () => {
  it.each([
    { name: 'GIF89a 修正为 .gif', filename: 'photo.png', bytes: gif, mimeType: 'image/png', ext: '.gif' },
    { name: 'JPEG 修正为 .jpg', filename: 'photo.png', bytes: jpeg, mimeType: 'image/png', ext: '.jpg' },
    { name: '真实 PNG 保留 .png', filename: 'photo.png', bytes: png, mimeType: 'image/png', ext: '.png' },
    { name: 'JPEG 保留 .jpeg', filename: 'photo.jpeg', bytes: jpeg, mimeType: 'image/png', ext: '.jpeg' },
    { name: '未知格式保留 .png', filename: 'photo.png', bytes: Buffer.from('unknown'), mimeType: 'image/png', ext: '.png' },
    { name: '非图片不修正扩展名', filename: 'data.bin', bytes: gif, mimeType: 'file', ext: '.bin' },
    { name: '无扩展名补全', filename: 'photo', bytes: gif, mimeType: 'image', ext: '.gif' },
    { name: '扩展名比较忽略大小写', filename: 'photo.JPEG', bytes: jpeg, mimeType: 'image/png', ext: '.JPEG' },
    { name: 'GIF87a 修正扩展名', filename: 'photo.png', bytes: Buffer.from('GIF87a'), mimeType: 'image/png', ext: '.gif' },
    { name: 'WebP 修正扩展名', filename: 'photo.png', bytes: Buffer.from('RIFF0000WEBP'), mimeType: 'image/png', ext: '.webp' },
    { name: 'BMP 修正扩展名', filename: 'photo.png', bytes: Buffer.from('BM0000'), mimeType: 'image/png', ext: '.bmp' },
  ])('$name', async ({ filename, bytes, mimeType, ext }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(bytes))));

    const results = await downloadMediaAttachments(
      [att({ filename, mimeType, size: bytes.length })],
      media,
      logger,
    );

    expect(results).toHaveLength(1);
    const result = results[0]!;
    expect(extname(result.localPath!)).toBe(ext);
    expect(result.filename).toBe(filename);
    expect(result.kind).toBe(mimeType === 'file' ? 'file' : 'image');
    expect(result.bytes).toBe(bytes.length);
    expect(readFileSync(result.localPath!)).toEqual(bytes);
    expect(readdirSync(MEDIA_DIR)).toEqual([basename(result.localPath!)]);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining(`→ ${result.localPath}`));
  });

  it('声明长度超限时直接放弃，不把大文件读进内存（#40）', async () => {
    let pulledBytes = 0;
    // 不用 Response：undici 对「流式 body + content-length」会做处理，这里要的是
    // 「服务端明确报了超大长度」这一种响应形态
    const huge = {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? String(64 * 1024 * 1024) : null) },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          pulledBytes += 1024;
          controller.enqueue(new Uint8Array(1024));
        },
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(huge));

    const results = await downloadMediaAttachments([att({ filename: 'big.png' })], media, logger);

    expect(results).toEqual([]);
    // 关键不是「一次都没读」，而是没有顺着 64MB 读下去
    expect(pulledBytes).toBeLessThan(1024 * 1024);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('exceeds'));
  });

  it('服务端不报长度时也在流上截断（chunked，#40）', async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(256 * 1024)); // 每次 256KB，maxMB=1 撑不了几轮
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(endless)));

    const results = await downloadMediaAttachments([att({ filename: 'endless.png' })], media, logger);

    expect(results).toEqual([]);
    // 在超限那一轮就停手，不是读到天荒地老（1MB / 256KB = 5 轮 + 预取 1 轮）
    expect(pulls).toBeLessThan(10);
  });

  it('跳转到内网地址时被拦截（每跳都验，不只首跳，#40）', async () => {
    vi.mocked(dns.promises.resolve4).mockImplementation(async (hostname: string) => (
      hostname === 'internal.example' ? ['127.0.0.1'] : ['8.8.8.8']
    ));
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://internal.example/secret' },
    })));

    const results = await downloadMediaAttachments([att({ filename: 'x.png' })], media, logger);

    expect(results).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('SSRF'));
  });

  it('富媒体未启用时直接返回空列表', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const results = await downloadMediaAttachments([att({ filename: 'a.png' })], { ...media, enabled: false }, logger);

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('跳过语音（纯文本模型消费不了音频，转写由中间件负责）', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const results = await downloadMediaAttachments(
      [att({ kind: 'voice', mimeType: 'audio/mpeg', filename: 'v.mp3' })],
      media,
      logger,
    );

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('超过 media.maxMB 的附件不下载', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const results = await downloadMediaAttachments(
      [att({ filename: 'huge.bin', kind: 'file', mimeType: 'file', size: 2 * 1024 * 1024 })],
      media,
      logger,
    );

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('too large'));
  });

  it('下载失败不抛错也不入结果（由 inbound 回退为描述）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));

    const results = await downloadMediaAttachments([att({ filename: 'x.png' })], media, logger);

    expect(results).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('download failed'));
  });

  it('缺 url 但有 fileId 时用注入的 file.query 解析再下载', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(png))));
    const resolveFileUrl = vi.fn().mockResolvedValue('https://file.example.com/f/1');

    const results = await downloadMediaAttachments(
      [att({ filename: 'fid.png', url: undefined, fileId: 'fid-1' })],
      media,
      logger,
      resolveFileUrl,
    );

    expect(resolveFileUrl).toHaveBeenCalledWith('fid-1');
    expect(results).toHaveLength(1);
  });

  it('缺 url 且没有解析器时跳过，不报错', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const results = await downloadMediaAttachments(
      [att({ filename: 'nourl.png', url: undefined, fileId: 'fid-2' })],
      media,
      logger,
    );

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('阻断环回地址（SSRF 防护），但内网文件服务照常放行', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(new Uint8Array(png)));
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['127.0.0.1']);
    expect(await downloadMediaAttachments([att({ filename: 'ssrf.png' })], media, logger)).toEqual([]);

    vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['10.1.2.3']);
    expect(await downloadMediaAttachments([att({ filename: 'intranet.png' })], media, logger)).toHaveLength(1);
  });
});

describe('downloadMessageMedia（中间件入口）', () => {
  function createCtx(attachments: InboundAttachment[], quote?: InboundAttachment[]): MiddlewareContext {
    return {
      message: {
        eventType: 'group_chat',
        kind: 'group',
        senderId: 'u1',
        senderAccount: 'zhangsan',
        senderName: '张三',
        content: 'hi',
        messageId: 'm1',
        timestamp: '',
        attachments,
        ...(quote !== undefined
          ? { reference: { text: 'quoted', attachments: quote } }
          : {}),
        raw: {},
      },
      state: {},
      replyTarget: { scope: 'group', targetId: 'g1' },
      bot: {} as MiddlewareContext['bot'],
      skip: () => {},
      skipped: undefined,
    };
  }

  const config = { media } as unknown as ImTuituiConfig;

  it('把当前消息与引用消息的媒体分别写入中间件状态', async () => {
    // 每次 fetch 都要新的 Response：body 只能消费一次
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(new Uint8Array(png))));
    const ctx = createCtx(
      [att({ filename: 'now.png' })],
      [att({ filename: 'quoted.png' })],
    );

    const result = await downloadMessageMedia(ctx, config, logger);

    expect(result.downloadedFiles).toHaveLength(1);
    expect(result.downloadedQuoteFiles).toHaveLength(1);
    expect(ctx.state.downloadedFiles).toEqual(result.downloadedFiles);
    expect(ctx.state.downloadedQuoteFiles).toEqual(result.downloadedQuoteFiles);
    expect(result.downloadedFiles[0]!.filename).toBe('now.png');
  });

  it('没有附件时写入空数组（下游无需判空）', async () => {
    const ctx = createCtx([]);

    const result = await downloadMessageMedia(ctx, config, logger);

    expect(result).toEqual({ downloadedFiles: [], downloadedQuoteFiles: [] });
    expect(ctx.state.downloadedFiles).toEqual([]);
  });
});

describe('imageExtension（纯函数：magic bytes 识别）', () => {
  it.each([
    { name: 'GIF89a', buf: Buffer.from('GIF89a\x01\x00', 'latin1'), ext: '.gif' },
    { name: 'GIF87a', buf: Buffer.from('GIF87a', 'latin1'), ext: '.gif' },
    { name: 'PNG', buf: Buffer.from('89504e470d0a1a0a', 'hex'), ext: '.png' },
    { name: 'JPEG', buf: Buffer.from('ffd8ffe0', 'hex'), ext: '.jpg' },
    { name: 'WebP', buf: Buffer.from('RIFF0000WEBP', 'latin1'), ext: '.webp' },
    { name: 'BMP', buf: Buffer.from('BM00', 'latin1'), ext: '.bmp' },
  ])('识别 $name → $ext', ({ buf, ext }) => {
    expect(imageExtension(buf)).toBe(ext);
  });

  it('未知格式 → undefined', () => {
    expect(imageExtension(Buffer.from('unknown-bytes'))).toBeUndefined();
  });

  it('短 buffer 不越界（安全落到 undefined）', () => {
    expect(imageExtension(Buffer.from([0xff]))).toBeUndefined();          // JPEG 需 3 字节
    expect(imageExtension(Buffer.from('RIFF', 'latin1'))).toBeUndefined(); // WebP 需 12 字节
    expect(imageExtension(Buffer.alloc(0))).toBeUndefined();
  });
});

describe('correctImageExt（纯函数：扩展名修正）', () => {
  const gifBytes = Buffer.from('GIF89a', 'latin1');
  const jpegBytes = Buffer.from('ffd8ff', 'hex');

  it('声明与真实不符 → 替换为真实扩展名，主体不变', () => {
    expect(correctImageExt('/m/photo_123.png', gifBytes)).toBe('/m/photo_123.gif');
  });

  it('声明与真实一致 → 原样返回', () => {
    expect(correctImageExt('/m/photo.gif', gifBytes)).toBe('/m/photo.gif');
  });

  it('jpg≈jpeg 视为等价 → 不改名', () => {
    expect(correctImageExt('/m/photo.jpeg', jpegBytes)).toBe('/m/photo.jpeg');
  });

  it('大小写不敏感比较 → 保留原名', () => {
    expect(correctImageExt('/m/photo.JPEG', jpegBytes)).toBe('/m/photo.JPEG');
  });

  it('未识别格式 → 原样返回', () => {
    expect(correctImageExt('/m/photo.png', Buffer.from('xx'))).toBe('/m/photo.png');
  });
});

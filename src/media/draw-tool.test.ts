/**
 * media/draw-tool 单测 —— tuitui_draw
 *
 * 覆盖：tools 服务缺失时安全降级、prompt 校验、出图落盘、
 * 默认发到当前会话、send=false 只存不发、拿不到会话时不报错只标 sent=false。
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDrawTool, DRAW_TOOL_NAME } from './draw-tool.ts';
import type { ImageGenerationConfig } from '../config.ts';
import type { Logger } from '../types.ts';

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger;

const config: ImageGenerationConfig = {
  enabled: true,
  baseUrl: 'https://llm.api.zyuncs.com/v1',
  apiKey: 'sk-image',
  model: 'qwen/qwen-image-2512',
  size: '1024x1024',
  timeoutMs: 5000,
};

const png = Buffer.from('fake-png-bytes');
const written: string[] = [];

function makeTools() {
  const registered: any[] = [];
  return {
    registered,
    ctx: { get: (name: string) => (name === 'tools' ? { register: (d: any) => { registered.push(d); } } : undefined) } as any,
  };
}

function makeSender() {
  const sent: any[] = [];
  return {
    sent,
    sender: {
      sendImage: async (target: any, source: any, opts: any) => { sent.push({ target, source, opts }); return { ok: true }; },
    } as any,
  };
}

function makeManager(record?: any) {
  return {
    findByAgent: vi.fn(() => record),
  } as any;
}

afterEach(() => {
  for (const file of written.splice(0)) { try { rmSync(file, { force: true }); } catch { /* ignore */ } }
  vi.unstubAllGlobals();
});

function stubOkImage(): void {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }),
  }));
}

describe('tuitui_draw', () => {
  it('tools 服务缺失时只告警，不抛异常', () => {
    const warn = vi.fn();
    registerDrawTool({ get: () => undefined } as any, makeSender().sender, makeManager(), config,
      { ...logger, warn } as unknown as Logger);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('工具未注册'));
  });

  it('注册的工具名与参数 schema 正常', () => {
    const { ctx, registered } = makeTools();
    registerDrawTool(ctx, makeSender().sender, makeManager(), config, logger);
    expect(registered[0].name).toBe(DRAW_TOOL_NAME);
    expect(registered[0].parameters.required).toEqual(['prompt']);
  });

  it('出图后落盘并发到当前会话', async () => {
    stubOkImage();
    const { ctx, registered } = makeTools();
    const { sender, sent } = makeSender();
    const target = { kind: 'group', id: 'g1' };
    registerDrawTool(ctx, sender, makeManager({ replyTarget: target }), config, logger);

    const result = await registered[0].execute({ prompt: '一只猫' }, { agent: {} });
    written.push(result.path as string);

    expect(existsSync(result.path as string)).toBe(true);
    expect(readFileSync(result.path as string)).toEqual(png);
    expect(result.sent).toBe(true);
    expect(sent[0].target).toBe(target);
    expect(sent[0].opts).toEqual({});
  });

  it('send=false 只落盘不发消息', async () => {
    stubOkImage();
    const { ctx, registered } = makeTools();
    const { sender, sent } = makeSender();
    registerDrawTool(ctx, sender, makeManager({ replyTarget: {} }), config, logger);

    const result = await registered[0].execute({ prompt: 'x', send: false });
    written.push(result.path as string);

    expect(result.sent).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('拿不到当前会话时不报错，只标 sent=false', async () => {
    stubOkImage();
    const { ctx, registered } = makeTools();
    const { sender, sent } = makeSender();
    registerDrawTool(ctx, sender, makeManager(undefined), config, logger);

    const result = await registered[0].execute({ prompt: 'x' });
    written.push(result.path as string);
    expect(result.sent).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('prompt 为空直接拒绝', async () => {
    const { ctx, registered } = makeTools();
    registerDrawTool(ctx, makeSender().sender, makeManager(), config, logger);
    await expect(registered[0].execute({ prompt: '   ' })).rejects.toThrow(/prompt 必填/);
  });

  it('上游失败时把原因抛给调用方（不是静默返回空图）', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'model not found' } }) }));
    const { ctx, registered } = makeTools();
    registerDrawTool(ctx, makeSender().sender, makeManager(), config, logger);
    await expect(registered[0].execute({ prompt: 'x' })).rejects.toThrow(/model not found/);
  });
});

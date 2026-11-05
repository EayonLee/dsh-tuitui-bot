/**
 * 回归：每个工具都必须真的能注册进 dsh。
 *
 * 事故现场（2026-11-04 之后一直如此）：dsh 的 tools.register() 要求
 * output: { schema, render }，我们没有声明，于是 group / history / file /
 * send / teams / bot / draw 七个工具全部注册失败，只在启动日志里留一行 warn。
 * 模型那边根本没有这些工具，问「群里有谁」它只能老实回「没这个能力」。
 *
 * 这里复刻 dsh 的校验规则做护栏：宁可单测失败，也不要线上静默消失。
 */
import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { registerGroupTool } from './group-tool.ts';
import { registerHistoryTool } from './history-tool.ts';
import { registerFileTool } from './file-tool.ts';
import { registerTeamsTool } from './teams-tool.ts';
import { registerBotTool } from './bot-tool.ts';
import { registerSendTool } from './message-tool.ts';
import { registerDrawTool } from '../media/draw-tool.ts';
import { registerSendFileTool } from '../media/send-file-tool.ts';
import { registerDescribeImageTool } from '../media/vision-tool.ts';
import { jsonToolOutput, summarizeToolResult } from './tool-output.ts';

/** 复刻 dsh tools.register 的校验：缺 output { schema, render } 直接抛 */
function createRegistry() {
  const names: string[] = [];
  const schemas: unknown[] = [];
  const register = vi.fn((definition: Record<string, any>) => {
    const output = definition?.output;
    if (output === undefined || typeof output !== 'object' || typeof output.render !== 'function') {
      throw new TypeError(`tool "${String(definition?.name)}" must declare output { schema, render, presentationMeta? }`);
    }
    if (output.schema === undefined || typeof output.schema !== 'object') {
      throw new TypeError(`tool "${String(definition?.name)}" output.schema must be an object schema`);
    }
    names.push(definition.name as string);
    schemas.push(output.schema);
    return () => undefined;
  });
  return { registry: { register }, names, schemas };
}

function createContext(registry: unknown): Context {
  return { get: (name: string) => (name === 'tools' ? registry : undefined) } as unknown as Context;
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const client = {} as never;
const sender = {} as never;
const manager = {} as never;

describe('工具注册（dsh 的 output 契约）', () => {
  it('群管理 / 聊天记录 / 文件 / 消息花样 / 频道 / 机器人自身 六个工具都能注册', () => {
    const { registry, names } = createRegistry();
    const ctx = createContext(registry);

    registerGroupTool(ctx, client, logger);
    registerHistoryTool(ctx, client, logger);
    registerFileTool(ctx, client, logger);
    registerTeamsTool(ctx, client, logger);
    registerBotTool(ctx, client, logger);
    registerSendTool(ctx, client, logger, () => undefined);

    expect(names.sort()).toEqual([
      'tuitui_bot',
      'tuitui_file',
      'tuitui_group',
      'tuitui_history',
      'tuitui_send',
      'tuitui_teams',
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('画图 / 发文件 / 看图三个媒体工具都能注册', () => {
    const { registry, names } = createRegistry();
    const ctx = createContext(registry);

    registerDrawTool(ctx, sender, manager, { enabled: true } as never, logger);
    registerSendFileTool(ctx, sender, manager, { cwd: '/tmp' } as never, logger);
    // 直连模式要求 baseUrl + apiKey 同时存在，否则会走「沿用 dsh llm」的老路
    registerDescribeImageTool(
      ctx,
      { enabled: true, baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'm' } as never,
      logger,
    );

    expect(names.sort()).toEqual(['tuitui_describe_image', 'tuitui_draw', 'tuitui_send_file']);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('每个工具的 output.schema 都是 object，render 能产出文本块', () => {
    const { registry, schemas } = createRegistry();
    registerGroupTool(createContext(registry), client, logger);

    const schema = schemas[0] as { type?: string };
    expect(schema.type).toBe('object');

    const output = jsonToolOutput();
    const blocks = output.render({}, { action: 'members', count: 2 });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'text' });
  });
});

describe('summarizeToolResult', () => {
  it('列出前几个字段，数组只报长度，不把长列表糊一屏', () => {
    const text = summarizeToolResult({
      action: 'members',
      count: 2,
      members: [{ account: 'a' }, { account: 'b' }],
      done: true,
    });
    expect(text).toContain('action=members');
    expect(text).toContain('count=2');
    expect(text).toContain('(2 项)');
  });

  it('空值不炸', () => {
    expect(summarizeToolResult(undefined)).toBe('（无返回）');
    expect(summarizeToolResult({})).toBe('（无返回）');
  });
});


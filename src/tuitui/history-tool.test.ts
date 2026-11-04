import { describe, it, expect, vi } from 'vitest';
import { registerHistoryTool } from './history-tool.ts';

function setup(msgs: unknown[] = []) {
  const registered: Array<{ name: string; execute: (args: unknown, exec?: unknown) => Promise<Record<string, unknown>> }> = [];
  const ctx = { get: (n: string) => (n === 'tools' ? { register: (d: unknown) => registered.push(d as never) } : undefined) } as never;
  const im = {
    getHistory: vi.fn(async () => ({ has_more: true, cursor: 'c1', msgs })),
  };
  const to = { group: (id: string) => ({ groupId: id }), account: (a: string) => ({ uids: [a] }) };
  const event = { renderMessageBody: (data: unknown) => (data as { text?: string })?.text ?? '' };
  const client = { im, to, event } as never;
  const logger = { info: vi.fn(), warn: vi.fn() } as never;
  registerHistoryTool(ctx, client, logger);
  return { tool: registered[0]!, im };
}

describe('tuitui_history', () => {
  it('群记录用 group 目标，消息渲染成一行文本', async () => {
    const { tool, im } = setup([
      { user_name: '张三', timestamp: '2026-11-04 10:00', data: { text: '早' } },
    ]);
    const out = await tool.execute({ action: 'group', group_id: 'g-1' });
    expect(im.getHistory).toHaveBeenCalledWith({ groupId: 'g-1' }, expect.objectContaining({ limit: 20 }));
    expect(out).toMatchObject({ count: 1, has_more: true, messages: [{ from: '张三', text: '早' }] });
  });

  it('私聊记录用 account 目标', async () => {
    const { tool, im } = setup();
    await tool.execute({ action: 'private', account: 'lizhengtai' });
    expect(im.getHistory).toHaveBeenCalledWith({ uids: ['lizhengtai'] }, expect.anything());
  });

  it('limit 夹在 1 到 100 之间', async () => {
    const { tool, im } = setup();
    await tool.execute({ action: 'group', group_id: 'g-1', limit: 999 });
    expect(im.getHistory).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: 100 }));
    await tool.execute({ action: 'group', group_id: 'g-1', limit: -5 });
    expect(im.getHistory).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ limit: 1 }));
  });

  it('缺 group_id / account 报错', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'group' })).rejects.toThrow(/group_id 必填/);
    await expect(tool.execute({ action: 'private' })).rejects.toThrow(/account 必填/);
  });

  it('action 不认识报错', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'everything' })).rejects.toThrow(/action/);
  });
});

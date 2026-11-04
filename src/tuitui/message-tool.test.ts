import { describe, it, expect, vi } from 'vitest';
import { registerSendTool, parseSendTarget } from './message-tool.ts';

function setup() {
  const registered: Array<{ name: string; execute: (args: unknown, exec?: unknown) => Promise<Record<string, unknown>> }> = [];
  const ctx = { get: (n: string) => (n === 'tools' ? { register: (d: unknown) => registered.push(d as never) } : undefined) } as never;
  const im = {
    sendLink: vi.fn(async () => ({})),
    sendPage: vi.fn(async () => ({})),
    sendMixed: vi.fn(async () => ({})),
    recall: vi.fn(async () => ({})),
    modifyText: vi.fn(async () => ({})),
    sendStrongNotice: vi.fn(async () => ({})),
    sendPhoneAlarm: vi.fn(async () => ({})),
  };
  const client = { im } as never;
  const logger = { info: vi.fn(), warn: vi.fn() } as never;
  registerSendTool(ctx, client, logger, () => ({ groupId: 'current' }));
  return { tool: registered[0]!, im };
}

describe('parseSendTarget', () => {
  it('解析 c2c 与 group', () => {
    expect(parseSendTarget('c2c:zhangsan')).toEqual({ uids: ['zhangsan'] });
    expect(parseSendTarget('group:g-1')).toEqual({ groupId: 'g-1' });
  });

  it('非法目标返回 undefined', () => {
    expect(parseSendTarget('')).toBeUndefined();
    expect(parseSendTarget('nope')).toBeUndefined();
    expect(parseSendTarget('team:t-1')).toBeUndefined();
    expect(parseSendTarget('c2c:')).toBeUndefined();
  });
});

describe('tuitui_send 格式类', () => {
  it('link 带上 url/title/正文', async () => {
    const { tool, im } = setup();
    await tool.execute({ action: 'link', url: 'https://x', title: '标题', text: '说明' });
    expect(im.sendLink).toHaveBeenCalledWith({
      to: { groupId: 'current' },
      link: { url: 'https://x', title: '标题', content: '说明' },
    });
  });

  it('page 用 text 当正文', async () => {
    const { tool, im } = setup();
    await tool.execute({ action: 'page', title: 'T', text: 'body' });
    expect(im.sendPage).toHaveBeenCalledWith({ to: { groupId: 'current' }, page: { title: 'T', content: 'body' } });
  });

  it('mixed 支持文字 + 图片', async () => {
    const { tool, im } = setup();
    await tool.execute({
      action: 'mixed',
      items: [{ type: 'text', text: '看图' }, { type: 'image', source_path: '/tmp/a.png' }],
    });
    expect(im.sendMixed).toHaveBeenCalledWith({
      to: { groupId: 'current' },
      items: [{ type: 'text', text: '看图' }, { type: 'image', source: '/tmp/a.png' }],
    });
  });

  it('mixed 图片项缺 source_path 报错', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'mixed', items: [{ type: 'image' }] })).rejects.toThrow(/source_path/);
  });
});

describe('tuitui_send 危险动作要 confirm', () => {
  it('recall / modify / strong_notice / phone_alarm 不带 confirm 全拒', async () => {
    const { tool, im } = setup();
    await expect(tool.execute({ action: 'recall', message_id: 'm1' })).rejects.toThrow(/confirm=true/);
    await expect(tool.execute({ action: 'modify', message_id: 'm1', text: 'x' })).rejects.toThrow(/confirm=true/);
    await expect(tool.execute({ action: 'strong_notice', account: 'a', text: 'x' })).rejects.toThrow(/confirm=true/);
    await expect(tool.execute({ action: 'phone_alarm', accounts: ['a'], text: 'x' })).rejects.toThrow(/confirm=true/);
    expect(im.recall).not.toHaveBeenCalled();
    expect(im.sendStrongNotice).not.toHaveBeenCalled();
  });

  it('带 confirm 才发强通知/报警', async () => {
    const { tool, im } = setup();
    await expect(tool.execute({ action: 'strong_notice', account: 'a', text: 'x', confirm: true })).resolves.toMatchObject({ done: true });
    await expect(tool.execute({ action: 'phone_alarm', accounts: ['a'], text: 'x', confirm: true })).resolves.toMatchObject({ done: true });
    expect(im.sendStrongNotice).toHaveBeenCalledWith({ account: 'a', content: 'x', smsNotice: false, callNotice: false });
  });

  it('phone_alarm 既没 accounts 也没 mobiles 报错', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'phone_alarm', text: 'x', confirm: true })).rejects.toThrow(/accounts 或 mobiles/);
  });

  it('显式 target 覆盖当前会话', async () => {
    const { tool, im } = setup();
    await tool.execute({ action: 'link', url: 'u', title: 't', target: 'c2c:zhangsan' });
    expect(im.sendLink).toHaveBeenCalledWith(expect.objectContaining({ to: { uids: ['zhangsan'] } }));
  });
});

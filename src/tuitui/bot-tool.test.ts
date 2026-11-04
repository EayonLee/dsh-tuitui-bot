import { describe, it, expect, vi } from 'vitest';
import { registerBotTool } from './bot-tool.ts';

function setup() {
  const registered: Array<{ name: string; execute: (args: unknown, exec?: unknown) => Promise<Record<string, unknown>> }> = [];
  const ctx = { get: (n: string) => (n === 'tools' ? { register: (d: unknown) => registered.push(d as never) } : undefined) } as never;
  const property = {
    info: vi.fn(async () => ({ name: '憨包', uid: 'u1', account: 'bot-1' })),
    getShortcutCommands: vi.fn(async () => [{ name: 'help', content: '/help', description: '帮助', tag: '默认' }]),
    setShortcutCommands: vi.fn(async () => ({})),
    setName: vi.fn(async () => ({})),
    setAvatar: vi.fn(async () => ({})),
    setWorkspaceMenus: vi.fn(async () => ({})),
  };
  const client = { property } as never;
  const logger = { info: vi.fn(), warn: vi.fn() } as never;
  registerBotTool(ctx, client, logger);
  return { tool: registered[0]!, property };
}

describe('tuitui_bot 只读', () => {
  it('info 返回机器人身份', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'info' })).resolves.toMatchObject({ name: '憨包', account: 'bot-1' });
  });

  it('get_shortcuts 返回现有指令', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'get_shortcuts' })).resolves.toMatchObject({ count: 1 });
  });
});

describe('tuitui_bot 写操作要 confirm', () => {
  it('改名不带 confirm 拒绝', async () => {
    const { tool, property } = setup();
    await expect(tool.execute({ action: 'set_name', name: '新名字' })).rejects.toThrow(/confirm=true/);
    expect(property.setName).not.toHaveBeenCalled();
  });

  it('换头像不带 confirm 拒绝', async () => {
    const { tool, property } = setup();
    await expect(tool.execute({ action: 'set_avatar', avatar: 'https://x/a.png' })).rejects.toThrow(/confirm=true/);
    expect(property.setAvatar).not.toHaveBeenCalled();
  });

  it('设菜单不带 confirm 拒绝', async () => {
    const { tool, property } = setup();
    await expect(tool.execute({ action: 'set_workspace_menus', menus: [{ name: 'a', url: 'u' }] })).rejects.toThrow(/confirm=true/);
    expect(property.setWorkspaceMenus).not.toHaveBeenCalled();
  });

  it('带 confirm 才改，且参数规整', async () => {
    const { tool, property } = setup();
    await expect(tool.execute({
      action: 'set_shortcuts',
      commands: [{ name: 'n', content: 'c', description: 'd', tag: 't' }],
      confirm: true,
    })).resolves.toMatchObject({ done: true, count: 1 });
    expect(property.setShortcutCommands).toHaveBeenCalledWith([{ name: 'n', content: 'c', description: 'd', tag: 't' }]);

    await expect(tool.execute({ action: 'set_name', name: '新名字', confirm: true })).resolves.toMatchObject({ name: '新名字' });
    expect(property.setName).toHaveBeenCalledWith('新名字');
  });

  it('空列表报错', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'set_shortcuts', commands: [], confirm: true })).rejects.toThrow(/需要 commands/);
    await expect(tool.execute({ action: 'set_workspace_menus', menus: [], confirm: true })).rejects.toThrow(/需要 menus/);
  });
});

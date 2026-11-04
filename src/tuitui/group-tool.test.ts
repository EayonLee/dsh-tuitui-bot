import { describe, it, expect, vi } from 'vitest';
import { registerGroupTool, GROUP_TOOL_NAME } from './group-tool.ts';

function setup() {
  const registered: Array<{ name: string; execute: (args: unknown) => Promise<Record<string, unknown>> }> = [];
  const ctx = {
    get: (name: string) =>
      name === 'tools'
        ? { register: (def: unknown) => registered.push(def as never) }
        : undefined,
  } as never;

  const group = {
    info: vi.fn(async (id: string) => ({ id, name: '测试群', announce: '公告' })),
    members: vi.fn(async () => [
      { uid: '1', account: 'zhangsan', name: '张三', role: 'admin', is_bot: false, dept: [] },
    ]),
    robotIn: vi.fn(async () => [{ group_id: 'g-1', name: '测试群' }]),
    userIsIn: vi.fn(async () => [{ group_id: 'g-1', name: '测试群' }]),
    create: vi.fn(async () => ({ group_id: 'g-new' })),
    memberAdd: vi.fn(async () => ({})),
    memberRemove: vi.fn(async () => ({})),
  };
  const client = { group } as never;
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as never;

  registerGroupTool(ctx, client, logger);
  const tool = registered[0]!;
  expect(tool.name).toBe(GROUP_TOOL_NAME);
  return { tool, group };
}

describe('tuitui_group 读操作', () => {
  it('info 返回群名和公告', async () => {
    const { tool } = setup();
    const out = await tool.execute({ action: 'info', group_id: 'g-1' });
    expect(out).toMatchObject({ id: 'g-1', name: '测试群', announce: '公告' });
  });

  it('members 只吐 account/name/role/is_bot', async () => {
    const { tool } = setup();
    const out = await tool.execute({ action: 'members', group_id: 'g-1' });
    expect(out).toMatchObject({ count: 1, members: [{ account: 'zhangsan', name: '张三', role: 'admin', is_bot: false }] });
  });

  it('robot_in 和 user_is_in 都不需要 confirm', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'robot_in' })).resolves.toMatchObject({ count: 1 });
    await expect(tool.execute({ action: 'user_is_in', user: 'zhangsan', groups: ['g-1'] })).resolves.toMatchObject({ count: 1 });
  });
});

describe('tuitui_group 写操作要 confirm', () => {
  it('建群不带 confirm 直接拒', async () => {
    const { tool, group } = setup();
    await expect(tool.execute({ action: 'create', name: '新群', owner: 'boss' })).rejects.toThrow(/confirm=true/);
    expect(group.create).not.toHaveBeenCalled();
  });

  it('拉人不带 confirm 直接拒', async () => {
    const { tool, group } = setup();
    await expect(tool.execute({ action: 'member_add', group_id: 'g-1', members: ['a'] })).rejects.toThrow(/confirm=true/);
    expect(group.memberAdd).not.toHaveBeenCalled();
  });

  it('踢人不带 confirm 直接拒', async () => {
    const { tool, group } = setup();
    await expect(tool.execute({ action: 'member_remove', group_id: 'g-1', members: ['a'] })).rejects.toThrow(/confirm=true/);
    expect(group.memberRemove).not.toHaveBeenCalled();
  });

  it('带 confirm 才真的动手', async () => {
    const { tool, group } = setup();
    await expect(tool.execute({ action: 'create', name: '新群', owner: 'boss', confirm: true })).resolves.toMatchObject({ group_id: 'g-new' });
    await expect(tool.execute({ action: 'member_remove', group_id: 'g-1', members: ['a'], confirm: true })).resolves.toMatchObject({ done: true });
    expect(group.create).toHaveBeenCalledOnce();
    expect(group.memberRemove).toHaveBeenCalledOnce();
  });
});

describe('tuitui_group 参数校验', () => {
  it('不认识的 action 报错', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'self_destruct' })).rejects.toThrow(/不认识的 action/);
  });

  it('缺 group_id 报错', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'info' })).rejects.toThrow(/group_id 必填/);
  });

  it('members 不是数组报错', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'member_add', group_id: 'g-1', members: 'a', confirm: true })).rejects.toThrow(/非空数组/);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerTeamsTool } from './teams-tool.ts';

function setup() {
  const registered: Array<{ name: string; execute: (args: unknown, exec?: unknown) => Promise<Record<string, unknown>> }> = [];
  const ctx = { get: (n: string) => (n === 'tools' ? { register: (d: unknown) => registered.push(d as never) } : undefined) } as never;
  const teams = {
    getChannelInfo: vi.fn(async (id: string) => ({ id, name: '研发频道' })),
    getChannelPosts: vi.fn(async () => ({ msgs: [{ post_id: 'p1' }], has_more: false, cursor: '' })),
    getPostChainForAgent: vi.fn(async () => [{ post_id: 'p1', content: '主帖' }]),
    getChannelPostTags: vi.fn(async () => ['讨论', '公告']),
    getMembers: vi.fn(async () => [{ uid: '1', name: '张三' }]),
    getMemberNames: vi.fn(async () => '张三、李四'),
    getAnnouncement: vi.fn(async () => ({ content: '通知' })),
    sendPost: vi.fn(async () => ({})),
    editPost: vi.fn(async () => ({})),
    sendFile: vi.fn(async () => ({})),
  };
  const client = { teams } as never;
  const logger = { info: vi.fn(), warn: vi.fn() } as never;
  registerTeamsTool(ctx, client, logger);
  return { tool: registered[0]!, teams };
}

function tmpFile() {
  const dir = mkdtempSync(join(tmpdir(), 'tuitui-teams-'));
  const path = join(dir, 'doc.md');
  writeFileSync(path, '# hi');
  return path;
}

describe('tuitui_teams 只读', () => {
  it('channel_info / post_tags / announcement 直接透传', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'channel_info', channel_id: 'c-1' })).resolves.toMatchObject({ info: { name: '研发频道' } });
    await expect(tool.execute({ action: 'post_tags', channel_id: 'c-1' })).resolves.toMatchObject({ tags: ['讨论', '公告'] });
    await expect(tool.execute({ action: 'announcement', channel_id: 'c-1' })).resolves.toMatchObject({ action: 'announcement' });
  });

  it('channel_posts 夹住 limit', async () => {
    const { tool, teams } = setup();
    await tool.execute({ action: 'channel_posts', channel_id: 'c-1', limit: 500 });
    expect(teams.getChannelPosts).toHaveBeenCalledWith('c-1', expect.objectContaining({ limit: 100 }));
  });

  it('post_chain 用 forAgent 版本', async () => {
    const { tool, teams } = setup();
    await expect(tool.execute({ action: 'post_chain', team_id: 't-1', channel_id: 'c-1', post_id: 'p1' })).resolves.toMatchObject({ count: 1 });
    expect(teams.getPostChainForAgent).toHaveBeenCalledWith('t-1', 'c-1', 'p1');
  });

  it('members / member_names', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'members', team_id: 't-1' })).resolves.toMatchObject({ action: 'members' });
    await expect(tool.execute({ action: 'member_names', team_id: 't-1' })).resolves.toMatchObject({ names: '张三、李四' });
  });
});

describe('tuitui_teams 写操作要 confirm', () => {
  it('发帖不带 confirm 拒绝', async () => {
    const { tool, teams } = setup();
    await expect(tool.execute({ action: 'send_post', team_id: 't-1', channel_id: 'c-1', text: 'x' })).rejects.toThrow(/confirm=true/);
    expect(teams.sendPost).not.toHaveBeenCalled();
  });

  it('改帖不带 confirm 拒绝', async () => {
    const { tool, teams } = setup();
    await expect(tool.execute({ action: 'edit_post', team_id: 't-1', channel_id: 'c-1', post_id: 'p1', text: 'x' })).rejects.toThrow(/confirm=true/);
    expect(teams.editPost).not.toHaveBeenCalled();
  });

  it('传文件不带 confirm 拒绝', async () => {
    const { tool, teams } = setup();
    await expect(tool.execute({ action: 'send_file', team_id: 't-1', channel_id: 'c-1', source_path: tmpFile() })).rejects.toThrow(/confirm=true/);
    expect(teams.sendFile).not.toHaveBeenCalled();
  });

  it('带 confirm 才真的发', async () => {
    const { tool, teams } = setup();
    await expect(tool.execute({
      action: 'send_post', team_id: 't-1', channel_id: 'c-1', text: '正文', parent_id: 'p0', tag: '讨论', confirm: true,
    })).resolves.toMatchObject({ done: true });
    expect(teams.sendPost).toHaveBeenCalledWith({
      teamId: 't-1', channelId: 'c-1', text: '正文', parentId: 'p0', tag: '讨论',
    });
  });

  it('缺字段报错', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'send_post', team_id: 't-1', channel_id: 'c-1', confirm: true })).rejects.toThrow(/text 必填/);
    await expect(tool.execute({ action: 'edit_post', team_id: 't-1', text: 'x', confirm: true })).rejects.toThrow(/channel_id 必填/);
  });
});

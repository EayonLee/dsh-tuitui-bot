import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerFileTool } from './file-tool.ts';

function setup() {
  const registered: Array<{ name: string; execute: (args: unknown, exec?: unknown) => Promise<Record<string, unknown>> }> = [];
  const ctx = { get: (n: string) => (n === 'tools' ? { register: (d: unknown) => registered.push(d as never) } : undefined) } as never;
  const file = {
    upload: vi.fn(async () => ({ fid: 'f-1', filename: 'a.txt', filesize: 3, mediaType: 'file' })),
    query: vi.fn(async () => 'https://x/a.txt'),
    batchQuery: vi.fn(async () => ({ 'f-1': 'https://x/a.txt' })),
  };
  const fileSpace = {
    listNodes: vi.fn(async () => [{ node_id: 'n1', node_type: '1', name: 'dir' }]),
    listFiles: vi.fn(async () => [{ filename: 'a.txt', author: 'x', url: 'u', filesize: '3' }]),
    listTeamFilesByChannel: vi.fn(async () => []),
    addNode: vi.fn(async () => ({})),
    deleteNode: vi.fn(async () => ({})),
    addFile: vi.fn(async () => ({})),
  };
  const client = { file, fileSpace } as never;
  const logger = { info: vi.fn(), warn: vi.fn() } as never;
  registerFileTool(ctx, client, logger);
  return { tool: registered[0]!, file, fileSpace };
}

function tmpFile(name = 'a.txt', body = 'hello') {
  const dir = mkdtempSync(join(tmpdir(), 'tuitui-file-'));
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

describe('tuitui_file 传与查', () => {
  it('upload 上传本地文件返回 fid', async () => {
    const { tool, file } = setup();
    const out = await tool.execute({ action: 'upload', source_path: tmpFile() });
    expect(file.upload).toHaveBeenCalledOnce();
    expect(out).toMatchObject({ fid: 'f-1', filename: 'a.txt' });
  });

  it('本地文件不存在要报错，且不打 API', async () => {
    const { tool, file } = setup();
    await expect(tool.execute({ action: 'upload', source_path: '/tmp/definitely-missing-xyz.txt' })).rejects.toThrow(/文件不存在/);
    expect(file.upload).not.toHaveBeenCalled();
  });

  it('query / batch_query 直接透传', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'query', fid: 'f-1' })).resolves.toMatchObject({ url: 'https://x/a.txt' });
    await expect(tool.execute({ action: 'batch_query', fids: ['f-1'] })).resolves.toMatchObject({ action: 'batch_query' });
  });

  it('batch_query 空数组报错', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'batch_query', fids: [] })).rejects.toThrow(/非空数组/);
  });
});

describe('tuitui_file 文件空间', () => {
  it('list_nodes / list_files / list_team_files 不用 confirm', async () => {
    const { tool, fileSpace } = setup();
    await expect(tool.execute({ action: 'list_nodes', space_id: 's-1' })).resolves.toMatchObject({ count: 1 });
    await expect(tool.execute({ action: 'list_files', space_id: 's-1' })).resolves.toMatchObject({ count: 1 });
    await expect(tool.execute({ action: 'list_team_files', channel_id: 'c-1' })).resolves.toMatchObject({ count: 0 });
    expect(fileSpace.listNodes).toHaveBeenCalledWith({ spaceId: 's-1' });
  });

  it('delete_node 不带 confirm 拒绝，且不调用', async () => {
    const { tool, fileSpace } = setup();
    await expect(tool.execute({ action: 'delete_node', space_id: 's-1', node_id: 'n1' })).rejects.toThrow(/confirm=true/);
    expect(fileSpace.deleteNode).not.toHaveBeenCalled();
  });

  it('add_file 不带 confirm 拒绝', async () => {
    const { tool, fileSpace } = setup();
    await expect(tool.execute({ action: 'add_file', space_id: 's-1', cloud_path: '/x', source_path: tmpFile() })).rejects.toThrow(/confirm=true/);
    expect(fileSpace.addFile).not.toHaveBeenCalled();
  });

  it('带 confirm 才真的删/加', async () => {
    const { tool, fileSpace } = setup();
    await expect(tool.execute({ action: 'delete_node', space_id: 's-1', node_id: 'n1', confirm: true })).resolves.toMatchObject({ done: true });
    await expect(tool.execute({
      action: 'add_file', space_id: 's-1', cloud_path: '/x', source_path: tmpFile(), confirm: true,
    })).resolves.toMatchObject({ done: true });
    expect(fileSpace.deleteNode).toHaveBeenCalledOnce();
    expect(fileSpace.addFile).toHaveBeenCalledOnce();
  });

  it('add_node 走文件空间，缺 name 报错', async () => {
    const { tool } = setup();
    await expect(tool.execute({ action: 'add_node', space_id: 's-1', confirm: true })).rejects.toThrow(/name 必填/);
  });
});

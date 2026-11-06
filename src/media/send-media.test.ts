/**
 * media 单测 —— 媒体发送、路径白名单、TTL 清理与发送工具
 *
 * 覆盖 send-media（分类发送 / 本地预检 / 降级）、send-file-tool（参数与
 * 白名单校验、目标解析）、media-cleaner（mtime TTL 清理、定时器挂载）。
 *
 * PLUGIN_HOME 在模块加载时由 os.homedir() 派生，因此本文件先把 HOME 指到
 * 临时目录，再动态 import 被测模块——清理用例只操作临时目录，绝不碰用户
 * 真实的 ~/.dsh-tuitui/media。
 */
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../types.ts';

const homeRoot = await mkdtemp(join(tmpdir(), 'tuitui-media-home-'));
const savedHome = process.env.HOME;
process.env.HOME = homeRoot;

const { sendMediaFile, isPathAllowed, isWithinRoot, resolveAgentCwd } = await import('./send-media.ts');
const { cleanupExpiredMedia, startMediaCleanup, MEDIA_ROOT } = await import('./media-cleaner.ts');
const { registerSendFileTool, SEND_FILE_TOOL_NAME } = await import('./send-file-tool.ts');

const extraDirs: string[] = [];

async function makeDir(prefix = 'tuitui-media-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  extraDirs.push(dir);
  return dir;
}

function makeLogger(): { logger: Logger; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } {
  const info = vi.fn();
  const warn = vi.fn();
  const debug = vi.fn();
  return { logger: { info, warn, debug, error: vi.fn() } as unknown as Logger, info, warn };
}

beforeAll(async () => {
  await mkdir(MEDIA_ROOT, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  while (extraDirs.length > 0) {
    const dir = extraDirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
  await rm(homeRoot, { recursive: true, force: true });
});

function sender() {
  return {
    sendImage: vi.fn(async () => ({ msgId: 'img-1' })),
    sendFile: vi.fn(async () => ({ msgId: 'file-1' })),
  };
}

const target = { scope: 'c2c', targetId: 'u-1' } as never;

describe('isWithinRoot 路径边界', () => {
  it('目录内文件放行，root 本身也放行', async () => {
    const root = await makeDir();
    const inner = join(root, 'a.txt');
    await writeFile(inner, 'x');

    expect(isWithinRoot(inner, root)).toBe(true);
    expect(isWithinRoot(root, root)).toBe(true);
  });

  it('拒绝 ../ 路径穿越', async () => {
    const root = await makeDir();
    const outside = join(root, '..', 'escape.txt');

    expect(isWithinRoot(outside, root)).toBe(false);
  });

  it('拒绝同前缀的兄弟目录（不按字符串前缀判定）', async () => {
    const root = await makeDir();
    const sibling = await makeDir();

    expect(isWithinRoot(join(sibling, 'f.txt'), root)).toBe(false);
  });

  it('root 不存在时视为无效白名单', async () => {
    const root = await makeDir();
    expect(isWithinRoot(join(root, 'a.txt'), join(root, 'missing-root'))).toBe(false);
  });

  it('root 内的符号链接指向外部时按真实路径拒绝', async () => {
    const root = await makeDir();
    const outside = await makeDir();
    const secret = join(outside, 'secret.txt');
    await writeFile(secret, 'x');
    const link = join(root, 'link.txt');
    const { symlink } = await import('node:fs/promises');
    await symlink(secret, link);

    expect(isWithinRoot(link, root)).toBe(false);
  });

  it('文件不存在时按最近存在祖先解析（不把「不存在」误报成「不允许」）', async () => {
    const root = await makeDir();
    expect(isWithinRoot(join(root, 'nested', 'new.png'), root)).toBe(true);
  });
});

describe('isPathAllowed 白名单', () => {
  const baseConfig = { restrictPaths: true, extraRoots: [] as string[], sendPresentedFiles: true, maxFiles: 5 };

  it('restrictPaths=false 时放行普通路径（敏感路径除外）', async () => {
    const outside = await makeDir();
    expect(isPathAllowed(join(outside, 'x.txt'), { ...baseConfig, restrictPaths: false }, homeRoot)).toBe(true);
  });

  it('敏感路径无论 restrictPaths 开关都拒绝（#34）', async () => {
    const dir = await makeDir();
    const loose = { ...baseConfig, restrictPaths: false };
    const strict = { ...baseConfig, restrictPaths: true };

    for (const config of [loose, strict]) {
      // 凭据文件：profile 里的、当前目录里的、改名备份的都不行
      expect(isPathAllowed(join(homeRoot, '.dsh', 'profiles', 'web', 'cordis.patch.yml'), config, dir)).toBe(false);
      expect(isPathAllowed(join(dir, 'cordis.patch.yml'), config, dir)).toBe(false);
      expect(isPathAllowed(join(dir, 'cordis.patch.yml.bak'), config, dir)).toBe(false);
      // 私钥与证书
      expect(isPathAllowed(join(homeRoot, '.ssh', 'id_rsa'), config, dir)).toBe(false);
      expect(isPathAllowed(join(homeRoot, '.ssh', 'config'), config, dir)).toBe(false);
      expect(isPathAllowed(join(dir, 'server.pem'), config, dir)).toBe(false);
      expect(isPathAllowed(join(dir, 'client.key'), config, dir)).toBe(false);
      // 环境变量与工具凭据
      expect(isPathAllowed(join(dir, '.env'), config, dir)).toBe(false);
      expect(isPathAllowed(join(dir, '.env.local'), config, dir)).toBe(false);
      expect(isPathAllowed(join(dir, '.npmrc'), config, dir)).toBe(false);
    }
  });

  it('profile 目录整体视为敏感（即使文件名看着无害）', async () => {
    const config = { ...baseConfig, restrictPaths: false };
    const profileFile = join(homeRoot, '.dsh', 'profiles', 'web', 'cordis.yml');
    expect(isPathAllowed(profileFile, config, homeRoot)).toBe(false);
  });

  it('大小写与符号链接不影响敏感判定', async () => {
    const dir = await makeDir();
    const real = join(dir, 'CORDIS.PATCH.YML');
    await writeFile(real, 'x');
    expect(isPathAllowed(real, { ...baseConfig, restrictPaths: false }, dir)).toBe(false);

    const { symlink } = await import('node:fs/promises');
    const link = join(dir, 'innocent.txt');
    await symlink(real, link);
    expect(isPathAllowed(link, { ...baseConfig, restrictPaths: false }, dir)).toBe(false);
  });

  it('cwd / media 目录 / extraRoots 内放行', async () => {
    const cwd = await makeDir();
    const extra = await makeDir();
    await writeFile(join(cwd, 'a.txt'), 'x');
    await writeFile(join(extra, 'b.txt'), 'x');
    await writeFile(join(MEDIA_ROOT, 'c.png'), 'x');
    const config = { ...baseConfig, extraRoots: [extra] };

    expect(isPathAllowed(join(cwd, 'a.txt'), config, cwd)).toBe(true);
    expect(isPathAllowed(join(extra, 'b.txt'), config, cwd)).toBe(true);
    expect(isPathAllowed(join(MEDIA_ROOT, 'c.png'), config, cwd)).toBe(true);
  });

  it('三个白名单之外拒绝，../ 穿越也拒绝', async () => {
    const cwd = await makeDir();
    const outside = await makeDir();
    const config = { ...baseConfig, extraRoots: [] };

    expect(isPathAllowed(join(outside, 'x.txt'), config, cwd)).toBe(false);
    expect(isPathAllowed(join(cwd, '..', 'y.txt'), config, cwd)).toBe(false);
  });

  it('resolveAgentCwd：空配置回落到 PLUGIN_HOME/workspace，显式配置优先', async () => {
    expect(resolveAgentCwd('')).toBe(join(homeRoot, '.dsh-tuitui', 'workspace'));
    expect(resolveAgentCwd(undefined)).toBe(join(homeRoot, '.dsh-tuitui', 'workspace'));
    expect(resolveAgentCwd('/srv/agent')).toBe('/srv/agent');
  });
});

describe('sendMediaFile 分类与降级', () => {
  it('jpg/png/gif 走 sendImage，其余走 sendFile', async () => {
    const dir = await makeDir();
    const bot = sender();
    for (const name of ['a.png', 'b.JPG', 'c.gif']) await writeFile(join(dir, name), 'x');
    await writeFile(join(dir, 'd.webp'), 'x');
    await writeFile(join(dir, 'e.pdf'), 'x');
    await writeFile(join(dir, 'noext'), 'x');

    for (const name of ['a.png', 'b.JPG', 'c.gif']) {
      const result = await sendMediaFile(bot as never, target, join(dir, name));
      expect(result.outcome).toBe('sent');
    }
    expect(bot.sendImage).toHaveBeenCalledTimes(3);

    await sendMediaFile(bot as never, target, join(dir, 'd.webp'));
    await sendMediaFile(bot as never, target, join(dir, 'e.pdf'));
    await sendMediaFile(bot as never, target, join(dir, 'noext'));
    expect(bot.sendFile).toHaveBeenCalledTimes(3);
  });

  it('本地文件返回真实 size，并透传 caption 与 msgId', async () => {
    const dir = await makeDir();
    const file = join(dir, 'report.pdf');
    await writeFile(file, 'hello world');
    const bot = sender();

    const result = await sendMediaFile(bot as never, target, file, { caption: '请查收' });

    expect(result).toEqual({ outcome: 'sent', size: 11, messageId: 'file-1' });
    expect(bot.sendFile).toHaveBeenCalledWith(target, file, { filename: 'report.pdf', caption: '请查收' });
  });

  it('空 caption 不传给发送器，发送结果无 msgId 时不带 messageId 字段', async () => {
    const dir = await makeDir();
    const file = join(dir, 'a.png');
    await writeFile(file, 'x');
    const bot = { sendImage: vi.fn(async () => ({})), sendFile: vi.fn(async () => ({})) };

    const result = await sendMediaFile(bot as never, target, file, { caption: '' });

    expect(result).toEqual({ outcome: 'sent', size: 1 });
    expect(bot.sendImage).toHaveBeenCalledWith(target, file, { filename: 'a.png' });
    expect(Object.keys(result)).not.toContain('messageId');
  });

  it('本地文件不存在返回 missing，不调用发送器', async () => {
    const dir = await makeDir();
    const bot = sender();

    const result = await sendMediaFile(bot as never, target, join(dir, 'nope.png'));

    expect(result).toEqual({ outcome: 'missing' });
    expect(bot.sendImage).not.toHaveBeenCalled();
    expect(bot.sendFile).not.toHaveBeenCalled();
  });

  it('目录路径返回 missing（不是普通文件）', async () => {
    const dir = await makeDir();
    const bot = sender();

    const result = await sendMediaFile(bot as never, target, dir);

    expect(result).toEqual({ outcome: 'missing' });
    expect(bot.sendFile).not.toHaveBeenCalled();
  });

  it('发送器抛错时降级为 failed 并透出原因', async () => {
    const dir = await makeDir();
    const file = join(dir, 'a.png');
    await writeFile(file, 'x');
    const bot = { sendImage: vi.fn(async () => { throw new Error('上传超时'); }), sendFile: vi.fn() };

    const result = await sendMediaFile(bot as never, target, file);

    expect(result).toEqual({ outcome: 'failed', error: '上传超时' });
  });

  it('http(s) URL 只交给 SDK，不本地预检；文件名取自 URL 并解码', async () => {
    const bot = sender();

    const result = await sendMediaFile(bot as never, target, 'https://cdn.example.com/a/%E6%8A%A5%E5%91%8A.pdf');

    expect(result).toEqual({ outcome: 'sent', size: 0, messageId: 'file-1' });
    expect(bot.sendFile).toHaveBeenCalledWith(target, 'https://cdn.example.com/a/%E6%8A%A5%E5%91%8A.pdf', {
      filename: '报告.pdf',
    });
  });

  it('内存字节来源：size 取 byteLength，按文件名分类', async () => {
    const bot = sender();
    const data = new Uint8Array([1, 2, 3, 4]);

    const result = await sendMediaFile(bot as never, target, { data, filename: 'pic.png' });

    expect(result).toEqual({ outcome: 'sent', size: 4, messageId: 'img-1' });
    expect(bot.sendImage).toHaveBeenCalledWith(target, { data, filename: 'pic.png' }, { filename: 'pic.png' });
  });

  it('fileName 选项覆盖默认文件名', async () => {
    const dir = await makeDir();
    const file = join(dir, 'internal-name.bin');
    await writeFile(file, 'xx');
    const bot = sender();

    await sendMediaFile(bot as never, target, file, { fileName: 'report.pdf' });

    expect(bot.sendFile).toHaveBeenCalledWith(target, file, { filename: 'report.pdf' });
  });
});

describe('registerSendFileTool', () => {
  interface ToolDefinition {
    name: string;
    parameters: { required: string[] };
    output: { render: (args: unknown, value: unknown) => Array<{ type: string; text: string }> };
    execute(args: unknown, exec: { signal: AbortSignal; agent?: unknown }): Promise<Record<string, unknown>>;
  }

  function setupTool(options: { withTools?: boolean; cwd?: string; managerTarget?: unknown } = {}) {
    const defs: ToolDefinition[] = [];
    const ctx = {
      get(name: string) {
        if (name !== 'tools') return undefined;
        return options.withTools === false ? undefined : { register: (definition: unknown) => { defs.push(definition as ToolDefinition); } };
      },
    };
    const bot = sender();
    const manager = {
      findByAgent: vi.fn(() => (options.managerTarget === undefined ? undefined : { replyTarget: options.managerTarget })),
    };
    const { logger, warn } = makeLogger();
    const config = {
      cwd: options.cwd ?? '',
      sendFile: { restrictPaths: true, extraRoots: [], sendPresentedFiles: true, maxFiles: 5 },
    };
    registerSendFileTool(ctx as never, bot as never, manager as never, config as never, logger);
    return { defs, bot, manager, warn, definition: defs[0] };
  }

  const signal = new AbortController().signal;

  it('tools 服务不可用时只 warn 不抛错', () => {
    const { defs, warn } = setupTool({ withTools: false });

    expect(defs).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tools 服务不可用'));
  });

  it('注册定义：名称/必填参数/render 文案', () => {
    const { definition } = setupTool();

    expect(definition?.name).toBe(SEND_FILE_TOOL_NAME);
    expect(definition?.parameters.required).toEqual(['file_path']);
    expect(definition?.output.render(undefined, { fileName: 'a.png', fileSize: 3, target: 'c2c:u-1' })).toEqual([
      { type: 'text', text: '已发送 a.png → c2c:u-1' },
    ]);
  });

  it('file_path 为空或非字符串时报错', async () => {
    const { definition } = setupTool();

    await expect(definition!.execute({}, { signal })).rejects.toThrow('file_path');
    await expect(definition!.execute({ file_path: '' }, { signal })).rejects.toThrow('file_path');
    await expect(definition!.execute({ file_path: 42 }, { signal })).rejects.toThrow('file_path');
  });

  it('target 语法非法时报错并回显收到的值', async () => {
    const { definition } = setupTool();

    await expect(definition!.execute({ file_path: '/tmp/a.png', target: 'wechat:u-1' }, { signal }))
      .rejects.toThrow(/target 格式错误.*wechat:u-1/);
    await expect(definition!.execute({ file_path: '/tmp/a.png', target: 'c2c:' }, { signal }))
      .rejects.toThrow('target 格式错误');
    await expect(definition!.execute({ file_path: '/tmp/a.png', target: ':u-1' }, { signal }))
      .rejects.toThrow('target 格式错误');
  });

  it('既无显式 target 也解析不到会话时报错', async () => {
    const { definition } = setupTool();

    await expect(definition!.execute({ file_path: '/tmp/a.png' }, { signal }))
      .rejects.toThrow('无法确定发送目标');
  });

  it('从 exec.agent 经 SessionManager 解析目标', async () => {
    const cwd = await makeDir();
    const file = join(cwd, 'a.txt');
    await writeFile(file, 'hi');
    const { definition, manager, bot } = setupTool({ cwd, managerTarget: { scope: 'group', targetId: 'g-9' } });

    const result = await definition!.execute({ file_path: file }, { signal, agent: { id: 'agent-1' } });

    expect(manager.findByAgent).toHaveBeenCalledWith({ id: 'agent-1' });
    expect(result).toEqual({ fileName: 'a.txt', fileSize: 2, target: 'group:g-9', messageId: 'file-1' });
    expect(bot.sendFile).toHaveBeenCalledWith({ scope: 'group', targetId: 'g-9' }, file, { filename: 'a.txt' });
  });

  it('显式 target 覆盖会话解析，图片走 sendImage', async () => {
    const cwd = await makeDir();
    const file = join(cwd, 'pic.png');
    await writeFile(file, 'png');
    const { definition, bot, manager } = setupTool({ cwd });

    const result = await definition!.execute({ file_path: file, target: 'c2c:u-7' }, { signal, agent: {} });

    expect(manager.findByAgent).not.toHaveBeenCalled();
    expect(result).toEqual({ fileName: 'pic.png', fileSize: 3, target: 'c2c:u-7', messageId: 'img-1' });
    expect(bot.sendImage).toHaveBeenCalledWith({ scope: 'c2c', targetId: 'u-7' }, file, { filename: 'pic.png' });
  });

  it('白名单外的路径被拒绝', async () => {
    const cwd = await makeDir();
    const outside = await makeDir();
    const file = join(outside, 'secret.txt');
    await writeFile(file, 'x');
    const { definition } = setupTool({ cwd });

    await expect(definition!.execute({ file_path: file, target: 'c2c:u-1' }, { signal }))
      .rejects.toThrow('不在允许的目录内');
  });

  it('文件不存在时报错（不进入发送）', async () => {
    const cwd = await makeDir();
    const { definition, bot } = setupTool({ cwd });

    await expect(definition!.execute({ file_path: join(cwd, 'ghost.txt'), target: 'c2c:u-1' }, { signal }))
      .rejects.toThrow('文件不存在');
    expect(bot.sendFile).not.toHaveBeenCalled();
  });

  it('发送器失败时报错并透出原因', async () => {
    const cwd = await makeDir();
    const file = join(cwd, 'a.txt');
    await writeFile(file, 'x');
    const { definition, bot } = setupTool({ cwd });
    bot.sendFile.mockRejectedValueOnce(new Error('网络中断'));

    await expect(definition!.execute({ file_path: file, target: 'c2c:u-1' }, { signal }))
      .rejects.toThrow('发送失败: 网络中断');
  });
});

describe('cleanupExpiredMedia TTL 清理', () => {
  const HOUR = 60 * 60 * 1000;

  async function makeAgedFile(name: string, ageMs: number): Promise<string> {
    const file = join(MEDIA_ROOT, name);
    await writeFile(file, 'x');
    const stamp = new Date(Date.now() - ageMs);
    await utimes(file, stamp, stamp);
    return file;
  }

  it('删除超过 TTL 的文件，保留未过期的文件，返回删除数', async () => {
    const expired = await makeAgedFile('expired-a.bin', 30 * HOUR);
    const fresh = await makeAgedFile('fresh-a.bin', 1 * HOUR);
    const { logger } = makeLogger();

    const cleaned = await cleanupExpiredMedia(24, logger);

    expect(cleaned).toBeGreaterThanOrEqual(1);
    expect(existsSync(expired)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it('mtime 恰好落在 TTL 边界内不删（<= ttl 保留）', async () => {
    const boundary = await makeAgedFile('boundary.bin', 2 * HOUR - 1000);
    const cleaned = await cleanupExpiredMedia(2, makeLogger().logger);

    expect(cleaned).toBe(0);
    expect(existsSync(boundary)).toBe(true);
  });

  it('ttlHours<=0 表示永不过期：直接返回 0 且不删文件', async () => {
    const old = await makeAgedFile('never-expire.bin', 365 * 24 * HOUR);

    expect(await cleanupExpiredMedia(0, makeLogger().logger)).toBe(0);
    expect(await cleanupExpiredMedia(-1, makeLogger().logger)).toBe(0);
    expect(existsSync(old)).toBe(true);
  });

  it('子目录不会被当成过期文件删除', async () => {
    const subDir = join(MEDIA_ROOT, 'nested-dir');
    await mkdir(subDir, { recursive: true });
    const stamp = new Date(Date.now() - 48 * HOUR);
    await utimes(subDir, stamp, stamp);

    await cleanupExpiredMedia(24, makeLogger().logger);

    expect(existsSync(subDir)).toBe(true);
    await rm(subDir, { recursive: true, force: true });
  });
});

describe('startMediaCleanup 定时清理挂载', () => {
  it('ttlHours<=0 时不挂 effect、不打印启动日志', () => {
    const effects: Array<{ name?: string }> = [];
    const ctx = { effect: (fn: () => () => void, name?: string) => { effects.push({ name, fn }); } };
    const { logger, info } = makeLogger();

    startMediaCleanup(ctx as never, 0, logger);

    expect(effects).toEqual([]);
    expect(info).not.toHaveBeenCalled();
  });

  it('ttlHours>0 时立即清理一次并按小时挂定时器，注销后停止', async () => {
    const effects: Array<{ name?: string; fn: () => () => Promise<void> | void }> = [];
    const ctx = { effect: (fn: () => () => Promise<void> | void, name?: string) => { effects.push({ name, fn }); } };
    const { logger, info } = makeLogger();
    const old = join(MEDIA_ROOT, 'startup-expired.bin');
    await writeFile(old, 'x');
    const stamp = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(old, stamp, stamp);

    startMediaCleanup(ctx as never, 24, logger);

    expect(effects.map((item) => item.name)).toEqual(['im-tuitui.media-cleanup']);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('ttl=24h'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining(MEDIA_ROOT));

    // 启动清理是异步 fire-and-forget，轮询等待文件消失
    for (let i = 0; i < 50 && existsSync(old); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(existsSync(old)).toBe(false);

    const disposer = effects[0]!.fn();
    await expect(Promise.resolve(disposer?.())).resolves.toBeUndefined();
  });
});

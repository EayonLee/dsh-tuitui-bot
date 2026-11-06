/**
 * setup/persist 单测 —— cordis.patch.yml 真实读写
 *
 * 每个用例在 os.tmpdir() 下建独立 profile 目录，写入真实 YAML 后读回断言：
 * 文档保真（注释/其他条目）、合并语义（点号键只写叶子）、fail-closed、幂等、
 * 原子写（不留 .tmp）与解绑的强制写回。
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  persistCredentialsToProfile,
  removeCredentialsFromProfile,
  updateProfileConfig,
} from './persist.ts';

const dirs: string[] = [];

async function makeProfileDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tuitui-persist-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

function makeLogger(): {
  log: { info: (msg: string) => void; warn: (msg: string) => void };
  info: string[];
  warn: string[];
} {
  const info: string[] = [];
  const warn: string[] = [];
  return {
    log: { info: (msg) => { info.push(msg); }, warn: (msg) => { warn.push(msg); } },
    info,
    warn,
  };
}

async function readPatch(dir: string): Promise<string> {
  return readFile(join(dir, 'cordis.patch.yml'), 'utf8');
}

interface PatchEntry {
  id?: string;
  config?: Record<string, unknown>;
}

function entriesOf(text: string): PatchEntry[] {
  const parsed = parse(text) as unknown;
  return Array.isArray(parsed) ? parsed as PatchEntry[] : [];
}

function imTuituiConfig(text: string): Record<string, unknown> {
  const entry = entriesOf(text).find((item) => item.id === 'im-tuitui');
  expect(entry).toBeDefined();
  return entry?.config ?? {};
}

describe('persistCredentialsToProfile', () => {
  it('空目录：新建成 YAML 数组条目并写入 appId/appSecret，不留临时文件', async () => {
    const dir = await makeProfileDir();
    const { log } = makeLogger();

    expect(persistCredentialsToProfile({ appId: 'app-1', appSecret: 'secret-1' }, dir, log)).toBe(true);

    const text = await readPatch(dir);
    expect(Array.isArray(parse(text))).toBe(true);
    expect(imTuituiConfig(text)).toEqual({ appId: 'app-1', appSecret: 'secret-1' });
    await expect(stat(join(dir, 'cordis.patch.yml.imtuitui.tmp'))).rejects.toThrow();
  });

  it('保留文件中其他插件条目与注释', async () => {
    const dir = await makeProfileDir();
    const { log } = makeLogger();
    const original = [
      '# 用户手写注释',
      '- id: other-plugin',
      '  config:',
      '    foo: bar',
      '',
      '- id: im-tuitui',
      '  config:',
      '    requireMention: true',
      '',
    ].join('\n');
    await writeFile(join(dir, 'cordis.patch.yml'), original, 'utf8');

    expect(persistCredentialsToProfile({ appId: 'app-2', appSecret: 'secret-2' }, dir, log)).toBe(true);

    const text = await readPatch(dir);
    expect(text).toContain('# 用户手写注释');
    expect(text).toContain('id: other-plugin');
    const entries = entriesOf(text);
    expect(entries.map((item) => item.id)).toEqual(['other-plugin', 'im-tuitui']);
    // 已有 config 键不被写入动作抹掉
    expect(imTuituiConfig(text)).toEqual({ requireMention: true, appId: 'app-2', appSecret: 'secret-2' });
  });

  it('重复写入同一凭据幂等：内容不再变化', async () => {
    const dir = await makeProfileDir();
    const { log } = makeLogger();

    expect(persistCredentialsToProfile({ appId: 'app-3', appSecret: 'secret-3' }, dir, log)).toBe(true);
    const first = await readPatch(dir);
    expect(persistCredentialsToProfile({ appId: 'app-3', appSecret: 'secret-3' }, dir, log)).toBe(true);
    expect(await readPatch(dir)).toBe(first);
  });

  it('未定位到 profile 目录时返回 false 并打印环境变量引导', async () => {
    const { log, warn } = makeLogger();
    const printed: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { printed.push(args.join(' ')); };

    try {
      expect(persistCredentialsToProfile({ appId: 'app-env', appSecret: 's-env' })).toBe(false);
    } finally {
      console.log = originalLog;
    }

    expect(warn).toEqual([]);
    expect(printed.join('\n')).toContain('TUITUI_BOT_APPID');
    expect(printed.join('\n')).toContain('app-env');
    // stdout 会进 web.log / journal：secret 绝不能明文出现（#44）
    expect(printed.join('\n')).not.toContain('s-env');
  });

  it('手动 YAML 引导同样不回显 secret（#44）', async () => {
    const dir = await makeProfileDir();
    const { log } = makeLogger();
    // 让写盘真的失败（路径被目录占用）：才会走到「手动填 YAML」引导分支
    await mkdir(join(dir, 'cordis.patch.yml'), { recursive: true });
    const printed: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { printed.push(args.join(' ')); };

    try {
      expect(persistCredentialsToProfile({ appId: 'app-yaml', appSecret: 'super-secret-value' }, dir, log)).toBe(false);
    } finally {
      console.log = originalLog;
    }

    const all = printed.join('\n');
    expect(all).toContain('cordis.patch.yml');
    expect(all).toContain('app-yaml');
    expect(all).not.toContain('super-secret-value');
    expect(all).toContain('不在日志里回显');
    expect(all).toContain('<上面输入的那串 AppSecret>');
  });

  it('顶层不是 YAML 数组时 fail-closed：拒绝写入且原文件逐字不变', async () => {
    const dir = await makeProfileDir();
    const { log, warn } = makeLogger();
    const original = 'id: im-tuitui\nconfig: {appId: old}\n';
    await writeFile(join(dir, 'cordis.patch.yml'), original, 'utf8');

    expect(persistCredentialsToProfile({ appId: 'new', appSecret: 'new' }, dir, log)).toBe(false);
    expect(await readPatch(dir)).toBe(original);
    expect(warn.some((line) => line.includes('拒绝写入'))).toBe(true);
  });

  it('条目 config 不是映射时 fail-closed', async () => {
    const dir = await makeProfileDir();
    const { log } = makeLogger();
    const original = '- id: im-tuitui\n  config: hello\n';
    await writeFile(join(dir, 'cordis.patch.yml'), original, 'utf8');

    expect(persistCredentialsToProfile({ appId: 'new', appSecret: 'new' }, dir, log)).toBe(false);
    expect(await readPatch(dir)).toBe(original);
  });

  it('config 被 YAML 锚点共享时 fail-closed（原地改会污染引用方）', async () => {
    const dir = await makeProfileDir();
    const { log } = makeLogger();
    const original = [
      '- id: shared-plugin',
      '  config: &sharedConfig',
      '    foo: bar',
      '- id: im-tuitui',
      '  config: *sharedConfig',
      '',
    ].join('\n');
    await writeFile(join(dir, 'cordis.patch.yml'), original, 'utf8');

    expect(persistCredentialsToProfile({ appId: 'new', appSecret: 'new' }, dir, log)).toBe(false);
    expect(await readPatch(dir)).toBe(original);
  });

  it('空文件（或仅注释）被安全重建为块式数组', async () => {
    const dir = await makeProfileDir();
    const { log } = makeLogger();
    await writeFile(join(dir, 'cordis.patch.yml'), '# 只有注释\n', 'utf8');

    expect(persistCredentialsToProfile({ appId: 'app-4', appSecret: 'secret-4' }, dir, log)).toBe(true);

    const text = await readPatch(dir);
    expect(text.startsWith('- id: im-tuitui')).toBe(true);
    expect(imTuituiConfig(text)).toEqual({ appId: 'app-4', appSecret: 'secret-4' });
  });
});

describe('updateProfileConfig', () => {
  it('点号键只写叶子：access.c2cMode 落到嵌套对象，同层其他键保留', async () => {
    const dir = await makeProfileDir();
    const { log } = makeLogger();
    await writeFile(join(dir, 'cordis.patch.yml'), [
      '- id: im-tuitui',
      '  config:',
      '    requireMention: true',
      '    access:',
      '      groupMode: allowlist',
      '      groupAllow: [g-1]',
      '    appId: app-keep',
      '    appSecret: secret-keep',
      '',
    ].join('\n'), 'utf8');

    const ok = updateProfileConfig({
      'access.c2cMode': 'blocklist',
      'access.groupAllow': ['g-1', 'g-2'],
      debug: true,
    }, dir, log);
    expect(ok).toBe(true);

    const config = imTuituiConfig(await readPatch(dir));
    expect(config.access).toEqual({
      groupMode: 'allowlist',
      groupAllow: ['g-1', 'g-2'],
      c2cMode: 'blocklist',
    });
    expect(config.requireMention).toBe(true);
    expect(config.debug).toBe(true);
  });

  it('不改写凭据字段（appId/appSecret 由绑定流程管理）', async () => {
    const dir = await makeProfileDir();
    const { log } = makeLogger();
    await writeFile(join(dir, 'cordis.patch.yml'), [
      '- id: im-tuitui',
      '  config:',
      '    appId: app-keep',
      '    appSecret: secret-keep',
      '',
    ].join('\n'), 'utf8');

    expect(updateProfileConfig({ appId: 'evil', appSecret: 'evil', provider: 'deepseek' }, dir, log)).toBe(true);

    const config = imTuituiConfig(await readPatch(dir));
    expect(config.appId).toBe('app-keep');
    expect(config.appSecret).toBe('secret-keep');
    expect(config.provider).toBe('deepseek');
  });

  it('无 im-tuitui 条目时追加到数组末尾，其他条目顺序不变', async () => {
    const dir = await makeProfileDir();
    const { log } = makeLogger();
    await writeFile(join(dir, 'cordis.patch.yml'), '- id: first\n  config: {}\n- id: second\n', 'utf8');

    expect(updateProfileConfig({ maxQueue: 8 }, dir, log)).toBe(true);

    const entries = entriesOf(await readPatch(dir));
    expect(entries.map((item) => item.id)).toEqual(['first', 'second', 'im-tuitui']);
    expect(entries.at(-1)?.config).toEqual({ maxQueue: 8 });
  });

  it('未定位到 profile 目录时返回 false 并给出两条 warn', async () => {
    const { log, warn } = makeLogger();

    expect(updateProfileConfig({ provider: 'deepseek' }, undefined, log)).toBe(false);
    expect(warn).toHaveLength(2);
    expect(warn[0]).toContain('未定位到 profile 目录');
    expect(warn[1]).toContain('cordis.patch.yml');
  });

  it('顶层非数组时拒绝写入', async () => {
    const dir = await makeProfileDir();
    const { log } = makeLogger();
    const original = '[]x';
    await writeFile(join(dir, 'cordis.patch.yml'), original, 'utf8');

    expect(updateProfileConfig({ provider: 'x' }, dir, log)).toBe(false);
    expect(await readPatch(dir)).toBe(original);
  });
});

describe('removeCredentialsFromProfile', () => {
  it('只删除 appId/appSecret，保留其余 config 与其他条目', async () => {
    const dir = await makeProfileDir();
    const { log } = makeLogger();
    await writeFile(join(dir, 'cordis.patch.yml'), [
      '- id: other',
      '  config:',
      '    keep: 1',
      '- id: im-tuitui',
      '  config:',
      '    appId: app-1',
      '    appSecret: secret-1',
      '    requireMention: false',
      '',
    ].join('\n'), 'utf8');

    expect(removeCredentialsFromProfile(dir, log)).toBe(true);

    const text = await readPatch(dir);
    const entries = entriesOf(text);
    expect(entries.map((item) => item.id)).toEqual(['other', 'im-tuitui']);
    expect(entries[0]?.config).toEqual({ keep: 1 });
    expect(imTuituiConfig(text)).toEqual({ requireMention: false });
  });

  it('字段本就不存在时仍强制写回一次（宿主 HMR 靠 mtime 触发）', async () => {
    const dir = await makeProfileDir();
    const { log, info } = makeLogger();
    const original = '- id: im-tuitui\n  config:\n    provider: deepseek\n';
    await writeFile(join(dir, 'cordis.patch.yml'), original, 'utf8');

    expect(removeCredentialsFromProfile(dir, log)).toBe(true);
    expect(await readPatch(dir)).toBe(original);
    expect(info.some((line) => line.includes('凭据已移除'))).toBe(true);
  });

  it('未定位到 profile 目录时返回 false（不打印引导）', async () => {
    const { log, warn } = makeLogger();
    expect(removeCredentialsFromProfile(undefined, log)).toBe(false);
    expect(warn).toEqual([]);
  });
});

/**
 * setup/self-update 单测 —— 下载、校验、备份、安装、回滚
 *
 * 这里不联网、不真装包：pnpm 用一个假可执行脚本顶替（它只改目标目录里的
 * package.json 版本），网络用一个假 fetch 顶替。测的是编排与失败路径，
 * 尤其是"失败了必须回到原样"这条硬要求。
 */
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyUpdate,
  assertMutableInstall,
  checkCompatibility,
  downloadPlan,
  ensureBundleListed,
  pickReleaseAsset,
  planUpdate,
  readHostVersion,
  readInstalledPackage,
  readManifestFromTarball,
  readVersionAt,
  sha256,
  type FetchLike,
  type UpdatePlan,
} from './self-update.ts';
import { makeTarball } from './tar-fixture.ts';

const temps: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

function jsonFetch(table: Record<string, { status?: number; body?: unknown }>): FetchLike {
  return async (url) => {
    const key = Object.keys(table).find((item) => url.includes(item));
    const entry = key === undefined ? undefined : table[key];
    if (entry === undefined) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const status = entry.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => entry.body as unknown,
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(entry.body)).buffer as ArrayBuffer,
    };
  };
}

/** 造一个"假 pnpm"：按环境变量把目标目录的 package.json 改成指定版本 */
async function fakePnpm(): Promise<string> {
  const dir = await tempDir('fake-pnpm-');
  const path = join(dir, 'pnpm');
  const script = [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const dir = process.env.FAKE_INSTALL_DIR;',
    "const version = process.env.FAKE_VERSION || '0.0.0';",
    "fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@eayonlee/dsh-tuitui-bot', version }));",
    'if (process.env.FAKE_OUTPUT) console.error(process.env.FAKE_OUTPUT);',
    'process.exit(Number(process.env.FAKE_EXIT || 0));',
    '',
  ].join('\n');
  await writeFile(path, script);
  await chmod(path, 0o755);
  return path;
}

/** 造一个 profile 目录（package.json）与一个"已安装包"目录 */
async function makeProfileAndPackage(options: { bundles?: string[]; version?: string } = {}): Promise<{ profileDir: string; installedDir: string }> {
  const profileDir = await tempDir('profile-');
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'profile',
    dependencies: { '@eayonlee/dsh-tuitui-bot': 'file:/tmp/old.tgz' },
    dsh: { profile: { bundles: options.bundles ?? [] } },
  }, null, 2));
  const installedDir = await tempDir('installed-');
  await writeFile(join(installedDir, 'package.json'), JSON.stringify({
    name: '@eayonlee/dsh-tuitui-bot',
    version: options.version ?? '0.1.30',
  }, null, 2));
  return { profileDir, installedDir };
}

describe('readInstalledPackage / readVersionAt', () => {
  it('读的是真实安装包的 name/version', async () => {
    const installed = await readInstalledPackage();
    const repo = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { name: string; version: string };
    expect(installed.name).toBe(repo.name);
    expect(installed.version).toBe(repo.version);
  });

  it('目录里没有 version 时如实报错', async () => {
    const dir = await tempDir('bad-pkg-');
    await writeFile(join(dir, 'package.json'), '{"name":"x"}');
    await expect(readVersionAt(dir)).rejects.toThrow(/没有 version/);
  });
});

describe('pickReleaseAsset', () => {
  const release = {
    tag_name: 'v0.1.31',
    assets: [
      { name: 'source.tar.gz', browser_download_url: 'https://example.com/source.tar.gz' },
      { name: 'dsh-tuitui-bot-0.1.31.tgz', browser_download_url: 'https://example.com/pkg.tgz', size: 1024, digest: 'sha256:abc' },
    ],
  };

  it('只认 dsh-tuitui-bot-<版本>.tgz 这一种命名', () => {
    const asset = pickReleaseAsset(release, '0.1.31');
    expect(asset?.browser_download_url).toBe('https://example.com/pkg.tgz');
    expect(asset?.digest).toBe('sha256:abc');
    expect(pickReleaseAsset(release, '0.1.32')).toBeNull();
    expect(pickReleaseAsset({ tag_name: 'v1', assets: 'nope' }, '1.0.0')).toBeNull();
  });
});

describe('planUpdate', () => {
  it('release 通道从 Release 里取 asset', async () => {
    const fetchImpl = jsonFetch({
      'api.github.com': {
        body: {
          tag_name: 'v0.1.31',
          assets: [{ name: 'dsh-tuitui-bot-0.1.31.tgz', browser_download_url: 'https://example.com/pkg.tgz' }],
        },
      },
    });
    const plan = await planUpdate({ slug: 'EayonLee/dsh-tuitui-bot', channel: 'release', fetchImpl, latestVersion: '0.1.31' });
    expect(plan.version).toBe('0.1.31');
    expect(plan.downloadUrl).toBe('https://example.com/pkg.tgz');
  });

  it('Release 里没有对应 asset 时拒绝（不退回任意 URL）', async () => {
    const fetchImpl = jsonFetch({ 'api.github.com': { body: { tag_name: 'v0.1.31', assets: [] } } });
    await expect(planUpdate({ slug: 'EayonLee/dsh-tuitui-bot', channel: 'release', fetchImpl, latestVersion: '0.1.31' }))
      .rejects.toThrow(/没有/);
  });

  it('main 通道用 github: spec，不下载 asset', async () => {
    const plan = await planUpdate({
      slug: 'EayonLee/dsh-tuitui-bot', channel: 'main', fetchImpl: jsonFetch({}), latestVersion: '0.1.32',
    });
    expect(plan.spec).toBe('github:EayonLee/dsh-tuitui-bot');
    expect(plan.downloadUrl).toBeUndefined();
  });
});

describe('sha256 / downloadPlan', () => {
  it('sha256 与标准值一致', () => {
    expect(sha256(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('摘要不匹配时拒绝安装', async () => {
    const dir = await tempDir('dl-');
    const plan: UpdatePlan = {
      version: '0.1.31', spec: 'https://example.com/pkg.tgz',
      downloadUrl: 'https://example.com/pkg.tgz', digest: 'sha256:' + '0'.repeat(64), label: 'test',
    };
    await expect(downloadPlan(plan, jsonFetch({ 'example.com': { body: { ok: true } } }), dir))
      .rejects.toThrow(/sha256 不匹配/);
  });

  it('下到 0 字节时拒绝', async () => {
    const dir = await tempDir('dl2-');
    const empty: FetchLike = async () => ({
      ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0),
    });
    await expect(downloadPlan({ version: '1.0.0', spec: 'x', downloadUrl: 'https://x/y.tgz', label: 't' }, empty, dir))
      .rejects.toThrow(/0 字节/);
  });
});

describe('ensureBundleListed', () => {
  it('缺失时补上，且不动其它字段', async () => {
    const { profileDir } = await makeProfileAndPackage({ bundles: [] });
    await ensureBundleListed(profileDir, '@eayonlee/dsh-tuitui-bot');
    const raw = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      dsh: { profile: { bundles: string[] } };
    };
    expect(raw.dsh.profile.bundles).toEqual(['@eayonlee/dsh-tuitui-bot']);
    expect(raw.dependencies['@eayonlee/dsh-tuitui-bot']).toBe('file:/tmp/old.tgz');
  });

  it('已存在时不重复、不重写', async () => {
    const { profileDir } = await makeProfileAndPackage({ bundles: ['@eayonlee/dsh-tuitui-bot'] });
    const before = await readFile(join(profileDir, 'package.json'), 'utf8');
    await ensureBundleListed(profileDir, '@eayonlee/dsh-tuitui-bot');
    expect(await readFile(join(profileDir, 'package.json'), 'utf8')).toBe(before);
  });
});

describe('applyUpdate', () => {
  it('成功：装上新版本、补 bundles、报出新版本号', async () => {
    const { profileDir, installedDir } = await makeProfileAndPackage({ bundles: [] });
    const pnpmCommand = await fakePnpm();
    process.env.FAKE_INSTALL_DIR = installedDir;
    process.env.FAKE_VERSION = '0.1.31';
    delete process.env.FAKE_EXIT;
    try {
      const outcome = await applyUpdate({
        plan: { version: '0.1.31', spec: 'file:/tmp/new.tgz', label: 'test' },
        installed: { name: '@eayonlee/dsh-tuitui-bot', version: '0.1.30', dir: installedDir },
        deps: { fetchImpl: jsonFetch({}), profileDir, packageName: '@eayonlee/dsh-tuitui-bot', pnpmCommand },
      });
      expect(outcome.ok).toBe(true);
      expect(outcome.to).toBe('0.1.31');
      expect(await readVersionAt(installedDir)).toBe('0.1.31');
      const raw = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } };
      expect(raw.dsh.profile.bundles).toContain('@eayonlee/dsh-tuitui-bot');
    } finally {
      delete process.env.FAKE_INSTALL_DIR;
      delete process.env.FAKE_VERSION;
    }
  });

  it('pnpm 失败：回滚到原版本，返回错误', async () => {
    const { profileDir, installedDir } = await makeProfileAndPackage({ bundles: [], version: '0.1.30' });
    const pnpmCommand = await fakePnpm();
    process.env.FAKE_INSTALL_DIR = installedDir;
    process.env.FAKE_VERSION = '0.1.31';
    process.env.FAKE_EXIT = '1';
    process.env.FAKE_OUTPUT = 'ERR_PNPM_FETCH_404';
    try {
      const outcome = await applyUpdate({
        plan: { version: '0.1.31', spec: 'file:/tmp/new.tgz', label: 'test' },
        installed: { name: '@eayonlee/dsh-tuitui-bot', version: '0.1.30', dir: installedDir },
        deps: { fetchImpl: jsonFetch({}), profileDir, packageName: '@eayonlee/dsh-tuitui-bot', pnpmCommand },
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('pnpm add 失败');
      expect(await readVersionAt(installedDir)).toBe('0.1.30');
    } finally {
      delete process.env.FAKE_INSTALL_DIR;
      delete process.env.FAKE_VERSION;
      delete process.env.FAKE_EXIT;
      delete process.env.FAKE_OUTPUT;
    }
  });

  it('装完版本不符：同样回滚', async () => {
    const { profileDir, installedDir } = await makeProfileAndPackage({ bundles: [], version: '0.1.30' });
    const pnpmCommand = await fakePnpm();
    process.env.FAKE_INSTALL_DIR = installedDir;
    process.env.FAKE_VERSION = '0.1.29';
    delete process.env.FAKE_EXIT;
    try {
      const outcome = await applyUpdate({
        plan: { version: '0.1.31', spec: 'file:/tmp/new.tgz', label: 'test' },
        installed: { name: '@eayonlee/dsh-tuitui-bot', version: '0.1.30', dir: installedDir },
        deps: { fetchImpl: jsonFetch({}), profileDir, packageName: '@eayonlee/dsh-tuitui-bot', pnpmCommand },
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('装完版本不符');
      expect(await readVersionAt(installedDir)).toBe('0.1.30');
    } finally {
      delete process.env.FAKE_INSTALL_DIR;
      delete process.env.FAKE_VERSION;
    }
  });
});

describe('readManifestFromTarball / readHostVersion', () => {
  it('从 tgz 里读出 package.json（含 dsh.compatibility）', () => {
    const tarball = makeTarball({
      'package/package.json': JSON.stringify({
        name: '@eayonlee/dsh-tuitui-bot',
        version: '0.1.31',
        dsh: { compatibility: { dshReleases: { '0.2.1-rc.5': 'compatible' } } },
      }),
    });
    const manifest = readManifestFromTarball(tarball);
    expect(manifest.name).toBe('@eayonlee/dsh-tuitui-bot');
    expect(manifest.version).toBe('0.1.31');
    expect(manifest.dsh?.compatibility?.dshReleases?.['0.2.1-rc.5']).toBe('compatible');
  });

  it('包里没有 package.json 时如实报错', () => {
    const tarball = makeTarball({ 'package/README.md': 'hi' });
    expect(() => readManifestFromTarball(tarball)).toThrow(/找不到 package.json/);
  });

  it('readHostVersion 在拿不到入口时返回 null 而不是瞎猜', () => {
    const original = process.argv[1];
    process.argv[1] = '/nonexistent/path/dsh';
    try {
      expect(readHostVersion()).toBeNull();
    } finally {
      process.argv[1] = original ?? '';
    }
  });
});

describe('checkCompatibility', () => {
  const manifest = {
    name: '@eayonlee/dsh-tuitui-bot',
    version: '0.1.31',
    dsh: { compatibility: { dshReleases: { '0.2.1-rc.5': 'compatible' } } },
  };

  it('宿主在兼容列表内 → 放行', () => {
    const verdict = checkCompatibility(manifest, '0.2.1-rc.5');
    expect(verdict).toMatchObject({ checked: true, ok: true });
  });

  it('宿主不在列表 → 拒绝并说明支持范围', () => {
    const verdict = checkCompatibility(manifest, '0.3.0');
    expect(verdict.checked).toBe(true);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('0.3.0');
    expect(verdict.message).toContain('0.2.1-rc.5');
  });

  it('显式标为非 compatible → 拒绝', () => {
    const verdict = checkCompatibility({
      dsh: { compatibility: { dshReleases: { '0.3.0': 'incompatible' } } },
    }, '0.3.0');
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('incompatible');
  });

  it('目标没声明兼容范围 → 放行但标注跳过', () => {
    const verdict = checkCompatibility({ name: 'x', version: '1.0.0' }, '0.2.1-rc.5');
    expect(verdict).toMatchObject({ checked: false, ok: true });
  });

  it('取不到宿主版本 → 放行但把支持范围写进文案', () => {
    const verdict = checkCompatibility(manifest, null);
    expect(verdict.checked).toBe(false);
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toContain('0.2.1-rc.5');
  });
});

describe('assertMutableInstall', () => {
  it('开发软链（link:）安装拒绝自动更新', async () => {
    const profileDir = await tempDir('profile-link-');
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      dependencies: { '@eayonlee/dsh-tuitui-bot': 'link:/repo/src' },
      dsh: { profile: { bundles: [] } },
    }));
    await expect(assertMutableInstall(profileDir, '@eayonlee/dsh-tuitui-bot'))
      .rejects.toThrow(/开发软链/);
  });

  it('tarball 安装允许更新', async () => {
    const profileDir = await tempDir('profile-file-');
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      dependencies: { '@eayonlee/dsh-tuitui-bot': 'file:/tmp/x.tgz' },
      dsh: { profile: { bundles: [] } },
    }));
    await expect(assertMutableInstall(profileDir, '@eayonlee/dsh-tuitui-bot')).resolves.toBeUndefined();
  });
});

describe('applyUpdate 安装前校验（真 tgz）', () => {
  async function setup(manifest: Record<string, unknown>): Promise<{
    profileDir: string; installedDir: string; pnpmCommand: string; fetchImpl: FetchLike;
  }> {
    const { profileDir, installedDir } = await makeProfileAndPackage({ bundles: [] });
    const pnpmCommand = await fakePnpm();
    process.env.FAKE_INSTALL_DIR = installedDir;
    process.env.FAKE_VERSION = '0.1.31';
    const tarball = makeTarball({ 'package/package.json': JSON.stringify(manifest) });
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      arrayBuffer: async () => tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.length) as ArrayBuffer,
    });
    return { profileDir, installedDir, pnpmCommand, fetchImpl };
  }

  it('宿主不兼容 → 拒绝，原版本不动', async () => {
    const { profileDir, installedDir, pnpmCommand, fetchImpl } = await setup({
      name: '@eayonlee/dsh-tuitui-bot', version: '0.1.31',
      dsh: { compatibility: { dshReleases: { '0.2.0': 'compatible' } } },
    });
    try {
      const outcome = await applyUpdate({
        plan: { version: '0.1.31', spec: 'x', downloadUrl: 'https://example.com/pkg.tgz', label: 'test' },
        installed: { name: '@eayonlee/dsh-tuitui-bot', version: '0.1.30', dir: installedDir },
        deps: { fetchImpl, profileDir, packageName: '@eayonlee/dsh-tuitui-bot', pnpmCommand, hostVersion: '0.2.1-rc.5' },
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('没验证过宿主');
      expect(await readVersionAt(installedDir)).toBe('0.1.30');
    } finally {
      delete process.env.FAKE_INSTALL_DIR;
      delete process.env.FAKE_VERSION;
    }
  });

  it('包名不符 → 拒绝（防止装进别的包）', async () => {
    const { profileDir, installedDir, pnpmCommand, fetchImpl } = await setup({
      name: '@evil/other', version: '0.1.31',
    });
    try {
      const outcome = await applyUpdate({
        plan: { version: '0.1.31', spec: 'x', downloadUrl: 'https://example.com/pkg.tgz', label: 'test' },
        installed: { name: '@eayonlee/dsh-tuitui-bot', version: '0.1.30', dir: installedDir },
        deps: { fetchImpl, profileDir, packageName: '@eayonlee/dsh-tuitui-bot', pnpmCommand, hostVersion: '0.2.1-rc.5' },
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('包名不符');
    } finally {
      delete process.env.FAKE_INSTALL_DIR;
      delete process.env.FAKE_VERSION;
    }
  });

  it('包内版本与计划不符 → 拒绝', async () => {
    const { profileDir, installedDir, pnpmCommand, fetchImpl } = await setup({
      name: '@eayonlee/dsh-tuitui-bot', version: '0.1.30',
    });
    try {
      const outcome = await applyUpdate({
        plan: { version: '0.1.31', spec: 'x', downloadUrl: 'https://example.com/pkg.tgz', label: 'test' },
        installed: { name: '@eayonlee/dsh-tuitui-bot', version: '0.1.30', dir: installedDir },
        deps: { fetchImpl, profileDir, packageName: '@eayonlee/dsh-tuitui-bot', pnpmCommand, hostVersion: '0.2.1-rc.5' },
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('包里版本不符');
    } finally {
      delete process.env.FAKE_INSTALL_DIR;
      delete process.env.FAKE_VERSION;
    }
  });

  it('兼容且版本一致 → 正常安装，detail 里写明兼容结论', async () => {
    const { profileDir, installedDir, pnpmCommand, fetchImpl } = await setup({
      name: '@eayonlee/dsh-tuitui-bot', version: '0.1.31',
      dsh: { compatibility: { dshReleases: { '0.2.1-rc.5': 'compatible' } } },
    });
    try {
      const outcome = await applyUpdate({
        plan: { version: '0.1.31', spec: 'x', downloadUrl: 'https://example.com/pkg.tgz', label: 'test' },
        installed: { name: '@eayonlee/dsh-tuitui-bot', version: '0.1.30', dir: installedDir },
        deps: { fetchImpl, profileDir, packageName: '@eayonlee/dsh-tuitui-bot', pnpmCommand, hostVersion: '0.2.1-rc.5' },
      });
      expect(outcome.ok).toBe(true);
      expect(outcome.detail).toContain('兼容列表内');
      expect(await readVersionAt(installedDir)).toBe('0.1.31');
    } finally {
      delete process.env.FAKE_INSTALL_DIR;
      delete process.env.FAKE_VERSION;
    }
  });
});

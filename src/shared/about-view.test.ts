import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { deriveAboutView, isBusy, manualCheckNote, type AboutPhase } from './about-view.ts';
import type { AboutWire, UpdateStatusWire } from './about-protocol.ts';

const ABOUT: AboutWire = {
  version: '0.1.30',
  repoUrl: 'https://github.com/EayonLee/dsh-tuitui-bot',
  repoSlug: 'EayonLee/dsh-tuitui-bot',
  packageName: '@eayonlee/dsh-tuitui-bot',
  selfUpdate: { enabled: true, channel: 'release', reason: null },
};

const STATUS_LATEST: UpdateStatusWire = {
  ok: true, latest: '0.1.30', hasUpdate: false, ahead: false, source: 'GitHub Release', error: null, cached: false,
};
const STATUS_UPDATE: UpdateStatusWire = {
  ok: true, latest: '0.1.31', hasUpdate: true, ahead: false, source: 'GitHub Release', error: null, cached: false,
};

const PHASES: AboutPhase[] = ['loading', 'idle', 'checking', 'applying', 'latest', 'update', 'ahead', 'failed', 'unavailable'];

function view(phase: AboutPhase, overrides: Partial<{ about: AboutWire | null; status: UpdateStatusWire | null; note: string | null }> = {}) {
  return deriveAboutView({
    about: overrides.about === undefined ? ABOUT : overrides.about,
    status: overrides.status === undefined ? null : overrides.status,
    phase,
    note: overrides.note === undefined ? null : overrides.note,
  });
}

describe('deriveAboutView · 版本号', () => {
  it('显示完整版本号', () => {
    expect(view('idle').versionLabel).toBe('v0.1.30');
  });

  it('任何状态下都不出现省略号或截断', () => {
    for (const phase of PHASES) {
      const label = view(phase).versionLabel;
      expect(label === null || label === 'v0.1.30').toBe(true);
      expect(label ?? '').not.toContain('…');
      expect(label ?? '').not.toContain('...');
    }
  });

  it('预发布这种长号也原样展示', () => {
    const about = { ...ABOUT, version: '0.1.31-beta.12' };
    expect(view('idle', { about }).versionLabel).toBe('v0.1.31-beta.12');
  });

  it('还没读到版本时不显示（而不是显示占位）', () => {
    expect(view('loading', { about: null }).versionLabel).toBeNull();
    expect(view('idle', { about: null }).versionTitle).toBeNull();
  });

  it('悬停说明带上版本号', () => {
    expect(view('idle').versionTitle).toContain('v0.1.30');
  });
});

describe('deriveAboutView · 检查更新按钮永远能按', () => {
  it('只有 checking / applying 时禁用', () => {
    for (const phase of PHASES) {
      const { check } = view(phase, { status: STATUS_LATEST });
      expect(check.enabled).toBe(!isBusy(phase));
    }
  });

  it('已是最新时仍可点', () => {
    expect(view('latest', { status: STATUS_LATEST }).check.enabled).toBe(true);
  });

  it('失败、待重启、本地更新时都可点', () => {
    for (const phase of ['failed', 'unavailable', 'ahead'] as AboutPhase[]) {
      expect(view(phase).check.enabled).toBe(true);
    }
  });

  it('进行中给的是等待文案', () => {
    expect(view('checking').check.label).toBe('检查中…');
    expect(view('applying').check.label).toBe('更新中…');
    expect(view('idle').check.label).toBe('检查更新');
    expect(view('latest', { status: STATUS_LATEST }).check.label).toBe('检查更新');
  });
});

describe('deriveAboutView · 更新按钮', () => {
  it('只有真有新版才出现', () => {
    expect(view('update', { status: STATUS_UPDATE }).apply).toEqual({ label: '更新到 v0.1.31', enabled: true });
  });

  it('其它状态一律没有更新按钮', () => {
    for (const phase of PHASES.filter((item) => item !== 'update')) {
      expect(view(phase, { status: STATUS_UPDATE }).apply).toBeNull();
    }
  });

  it('update 状态但拿不到 latest 时不出现（避免死按钮）', () => {
    expect(view('update', { status: { ...STATUS_UPDATE, latest: null } }).apply).toBeNull();
    expect(view('update', { status: { ...STATUS_UPDATE, ok: false } }).apply).toBeNull();
  });

  it('更新中禁用', () => {
    expect(view('applying', { status: STATUS_UPDATE }).apply).toBeNull();
    expect(view('update', { status: STATUS_UPDATE }).apply?.enabled).toBe(true);
  });
});

describe('deriveAboutView · 状态标签必须有颜色', () => {
  it('待重启 = 橙色警示', () => {
    expect(view('unavailable').chip).toMatchObject({ label: '待重启', tone: 'warn' });
  });

  it('检查失败 = 橙色警示', () => {
    expect(view('failed', { note: '网络不通' }).chip).toMatchObject({ label: '检查失败', tone: 'warn' });
  });

  it('已是最新 = 绿色', () => {
    expect(view('latest', { status: STATUS_LATEST }).chip).toMatchObject({ label: '已是最新', tone: 'ok' });
  });

  it('本地更新 = 蓝色', () => {
    expect(view('ahead').chip).toMatchObject({ label: '本地更新', tone: 'info' });
  });

  it('进行中 = 中性色', () => {
    expect(view('checking').chip).toMatchObject({ label: '检查中', tone: 'muted' });
    expect(view('applying').chip).toMatchObject({ label: '更新中', tone: 'muted' });
  });

  it('正常态不挂多余标签', () => {
    expect(view('idle').chip).toBeNull();
    expect(view('loading').chip).toBeNull();
  });

  it('标签说明里带失败原因 / 线上版本', () => {
    expect(view('failed', { note: 'HTTP 403' }).chip?.title).toBe('HTTP 403');
    expect(view('latest', { status: STATUS_LATEST }).chip?.title).toContain('0.1.30');
  });
});

describe('deriveAboutView · 仓库入口', () => {
  it('用服务端给的地址', () => {
    const result = view('idle');
    expect(result.repoUrl).toBe(ABOUT.repoUrl);
    expect(result.repoTitle).toContain(ABOUT.repoSlug);
  });

  it('读不到 about 时退回常量，不留空链接', () => {
    const result = view('unavailable', { about: null });
    expect(result.repoUrl).toBe('https://github.com/EayonLee/dsh-tuitui-bot');
    expect(result.repoTitle).toContain('EayonLee/dsh-tuitui-bot');
  });
});

describe('manualCheckNote', () => {
  it('已是最新给出明确回执', () => {
    expect(manualCheckNote(STATUS_LATEST)).toBe('已是最新（v0.1.30）');
  });

  it('没有 latest 时也能给回执', () => {
    expect(manualCheckNote({ ...STATUS_LATEST, latest: null })).toBe('已是最新');
  });

  it('有新版时告诉你新版号', () => {
    expect(manualCheckNote(STATUS_UPDATE)).toBe('发现新版本 v0.1.31');
  });

  it('本地比线上新时说清楚', () => {
    expect(manualCheckNote({ ...STATUS_LATEST, ahead: true, latest: '0.1.29' })).toBe('本地版本比线上新（线上 v0.1.29）');
  });

  it('检查失败如实说原因', () => {
    expect(manualCheckNote({ ok: false, latest: null, hasUpdate: false, ahead: false, source: null, error: '全部源失败', cached: false }))
      .toBe('全部源失败');
  });
});

describe('about-bar 源码约束', () => {
  const source = readFileSync(new URL('../client/about-bar.ts', import.meta.url), 'utf8');

  it('不拿省略号当版本占位', () => {
    expect(source).not.toContain("'…'");
    expect(source).not.toContain('">…"');
  });

  it('版本与按钮都走 deriveAboutView，不在组件里另写一套判断', () => {
    expect(source).toContain('deriveAboutView');
    expect(source).toContain('view.check.enabled');
    expect(source).toContain('view.apply');
  });

  it('状态标签用 tone 决定颜色类名', () => {
    expect(source).toContain("imqb-about-chip--' + view.chip.tone");
  });
});

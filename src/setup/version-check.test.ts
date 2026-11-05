/**
 * setup/version-check 单测 —— 版本比较与多源查询
 *
 * 重点是那些"看起来无所谓、实际上会骗人"的分支：
 *   · 版本号不能按字符串比（0.1.100 < 0.1.30 是错的）
 *   · 多源必须取最大，不能先到先得（jsDelivr 有 CDN 缓存）
 *   · 一个源都没成功时必须报错，绝不能落到"已是最新"
 *   · 查失败不写缓存（否则一次网络抖动会钉住 6 小时）
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSources,
  checkLatest,
  compareVersions,
  isNewer,
  lookupLatest,
  parseVersion,
  resetLatestCache,
  type FetchLike,
} from './version-check.ts';

afterEach(() => { resetLatestCache(); });

/** 造一个按 host 分支的假 fetch */
function fakeFetch(table: Record<string, { status?: number; body?: unknown; fail?: 'throw' | 'timeout' }>, counter?: { calls: number }): FetchLike {
  return async (url) => {
    if (counter !== undefined) counter.calls += 1;
    const key = Object.keys(table).find((item) => url.includes(item));
    const entry = key === undefined ? undefined : table[key];
    if (entry === undefined) return { ok: false, status: 404, json: async () => ({}) as unknown, text: async () => '' };
    if (entry.fail === 'throw') throw new Error('网络断了');
    if (entry.fail === 'timeout') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const status = entry.status ?? 200;
    const body = entry.body;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body as unknown,
      text: async () => JSON.stringify(body),
    };
  };
}

describe('parseVersion / compareVersions', () => {
  it('认 v 前缀与预发布标记', () => {
    expect(parseVersion('v1.2.3').nums).toEqual([1, 2, 3]);
    expect(parseVersion('1.2.3-beta.2')).toEqual({ nums: [1, 2, 3], prerelease: 'beta.2' });
    expect(parseVersion('乱七八糟').nums).toEqual([0, 0, 0]);
  });

  it('按数字比，而不是按字符串比', () => {
    expect(compareVersions('0.1.100', '0.1.30')).toBe(1);
    expect(compareVersions('0.1.30', '0.1.30')).toBe(0);
    expect(compareVersions('v0.2.0', '0.1.99')).toBe(1);
  });

  it('正式版比预发布新', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.1')).toBe(1);
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
  });

  it('isNewer 只认严格更新', () => {
    expect(isNewer('0.1.31', '0.1.30')).toBe(true);
    expect(isNewer('0.1.30', '0.1.30')).toBe(false);
    expect(isNewer('0.1.29', '0.1.30')).toBe(false);
  });
});

describe('buildSources', () => {
  const slug = 'EayonLee/dsh-tuitui-bot';

  it('release 通道只用 Release（不混主干，避免提示一个装不了的版本）', () => {
    const sources = buildSources(slug, 'release');
    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toContain('/releases/latest');
  });

  it('main 通道看主干 package.json，jsDelivr 兜底', () => {
    const sources = buildSources(slug, 'main');
    expect(sources[0]?.url).toContain('raw.githubusercontent.com');
    expect(sources.some((item) => item.url.includes('cdn.jsdelivr.net'))).toBe(true);
  });
});

describe('lookupLatest', () => {
  it('release 通道取 Release 的 tag', async () => {
    const fetchImpl = fakeFetch({ 'api.github.com': { body: { tag_name: 'v0.1.31' } } });
    const result = await lookupLatest('EayonLee/dsh-tuitui-bot', 'release', fetchImpl);
    expect(result.latest).toBe('0.1.31');
    expect(result.source).toBe('GitHub Release');
    expect(result.error).toBeNull();
  });

  it('main 通道多源取最大，并标明来源', async () => {
    const fetchImpl = fakeFetch({
      'api.github.com': { body: { tag_name: 'v0.1.30' } },
      'raw.githubusercontent.com': { body: { version: '0.1.31' } },
      'cdn.jsdelivr.net': { body: { version: '0.1.29' } },
    });
    const result = await lookupLatest('EayonLee/dsh-tuitui-bot', 'main', fetchImpl);
    expect(result.latest).toBe('0.1.31');
    expect(result.source).toBe('GitHub 主干');
    expect(result.error).toBeNull();
  });

  it('只有预发布版本时不算有新版（并说明原因）', async () => {
    const fetchImpl = fakeFetch({ 'api.github.com': { body: { tag_name: 'v0.1.31-beta.1' } } });
    const result = await lookupLatest('EayonLee/dsh-tuitui-bot', 'release', fetchImpl);
    expect(result.latest).toBeNull();
    expect(result.error).toContain('预发布');
  });

  it('单个源失败不影响其它源（main 通道）', async () => {
    const fetchImpl = fakeFetch({
      'raw.githubusercontent.com': { fail: 'throw' },
      'cdn.jsdelivr.net': { body: { version: '0.1.31' } },
    });
    const result = await lookupLatest('EayonLee/dsh-tuitui-bot', 'main', fetchImpl);
    expect(result.latest).toBe('0.1.31');
    expect(result.source).toBe('jsDelivr');
  });

  it('全部失败时 latest=null 且给出各源原因（绝不落到"已是最新"）', async () => {
    const fetchImpl = fakeFetch({ 'api.github.com': { fail: 'timeout' } });
    const result = await lookupLatest('EayonLee/dsh-tuitui-bot', 'release', fetchImpl);
    expect(result.latest).toBeNull();
    expect(result.source).toBeNull();
    expect(result.error).toContain('GitHub Release');
    expect(result.error).toContain('超时');
  });

  it('HTTP 非 2xx 也算失败', async () => {
    const fetchImpl = fakeFetch({ 'api.github.com': { status: 403 } });
    const result = await lookupLatest('EayonLee/dsh-tuitui-bot', 'release', fetchImpl);
    expect(result.latest).toBeNull();
    expect(result.error).toContain('HTTP 403');
  });
});

describe('checkLatest 缓存', () => {
  const fetchImpl = fakeFetch({ 'raw.githubusercontent.com': { body: { version: '0.1.31' } } });

  it('TTL 内命中缓存，不再发请求', async () => {
    const counter = { calls: 0 };
    const counting = fakeFetch({ 'raw.githubusercontent.com': { body: { version: '0.1.31' } } }, counter);
    const first = await checkLatest({ slug: 'a/b', channel: 'main', fetchImpl: counting, now: 1_000 });
    const callsAfterFirst = counter.calls;
    const second = await checkLatest({ slug: 'a/b', channel: 'main', fetchImpl: counting, now: 2_000 });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.latest).toBe('0.1.31');
    expect(counter.calls).toBe(callsAfterFirst);
  });

  it('refresh 绕过缓存', async () => {
    const counter = { calls: 0 };
    const counting = fakeFetch({ 'raw.githubusercontent.com': { body: { version: '0.1.31' } } }, counter);
    await checkLatest({ slug: 'c/d', channel: 'main', fetchImpl: counting, now: 1_000 });
    const before = counter.calls;
    const forced = await checkLatest({ slug: 'c/d', channel: 'main', fetchImpl: counting, refresh: true, now: 1_100 });
    expect(forced.cached).toBe(false);
    expect(counter.calls).toBeGreaterThan(before);
  });

  it('缓存过期后重新查', async () => {
    const counter = { calls: 0 };
    const counting = fakeFetch({ 'raw.githubusercontent.com': { body: { version: '0.1.31' } } }, counter);
    await checkLatest({ slug: 'e/f', channel: 'main', fetchImpl: counting, now: 0, ttlMs: 10 });
    const stale = await checkLatest({ slug: 'e/f', channel: 'main', fetchImpl: counting, now: 100, ttlMs: 10 });
    expect(stale.cached).toBe(false);
  });

  it('查失败不写缓存：下一次会重新尝试', async () => {
    const failing = fakeFetch({ 'api.github.com': { fail: 'throw' } });
    const first = await checkLatest({ slug: 'g/h', channel: 'release', fetchImpl: failing, now: 1 });
    expect(first.latest).toBeNull();
    const working = fakeFetch({
      'api.github.com': { body: { tag_name: 'v0.2.0' } },
      'raw.githubusercontent.com': { body: { version: '0.1.0' } },
    });
    const second = await checkLatest({ slug: 'g/h', channel: 'release', fetchImpl: working, now: 2 });
    expect(second.latest).toBe('0.2.0');
    expect(second.cached).toBe(false);
  });
});

/**
 * 启动版本提示（0.1.34）
 *
 * 只关心三件事：有新版打一行、没新版不吵、查不到不炸。
 */
import { describe, expect, it, vi } from 'vitest';
import { notifyUpdateOnStartup } from './startup-version.ts';
import { resetLatestCache } from './version-check.ts';
import type { Logger } from '../types.ts';

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies Logger;
}

const releaseJson = (version: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ tag_name: 'v' + version, name: 'v' + version }),
});

describe('notifyUpdateOnStartup', () => {
  it('有更新时打一行 info，并给出升级命令', async () => {
    resetLatestCache();
    const logger = makeLogger();
    const notice = await notifyUpdateOnStartup({
      channel: 'release',
      logger,
      readVersion: async () => '0.1.33',
      fetchImpl: async () => releaseJson('0.1.34'),
    });

    expect(notice?.latest).toBe('0.1.34');
    expect(logger.info).toHaveBeenCalledTimes(1);
    const message = String(logger.info.mock.calls[0]?.[0]);
    expect(message).toContain('0.1.34');
    expect(message).toContain('@latest');
  });

  it('已是最新版时只留 debug，不打扰用户', async () => {
    resetLatestCache();
    const logger = makeLogger();
    const notice = await notifyUpdateOnStartup({
      channel: 'release',
      logger,
      readVersion: async () => '0.1.34',
      fetchImpl: async () => releaseJson('0.1.34'),
    });

    expect(notice?.message).toBeNull();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('查不到/网络挂掉时静默返回 null，不抛也不警告', async () => {
    resetLatestCache();
    const logger = makeLogger();
    const notice = await notifyUpdateOnStartup({
      channel: 'release',
      logger,
      readVersion: async () => '0.1.33',
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });

    expect(notice).toBeNull();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('本地版本读不到时同样静默', async () => {
    resetLatestCache();
    const logger = makeLogger();
    const notice = await notifyUpdateOnStartup({
      channel: 'release',
      logger,
      readVersion: async () => {
        throw new Error('no package.json');
      },
      fetchImpl: async () => releaseJson('0.1.34'),
    });

    expect(notice).toBeNull();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

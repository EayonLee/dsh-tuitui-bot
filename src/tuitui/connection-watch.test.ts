import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionWatch } from './connection-watch.ts';
import type { Logger } from '../types.ts';

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

let now = 0;
const clock = () => now;

beforeEach(() => {
  now = 1_000_000;
});

describe('ConnectionWatch', () => {
  it('连上后一直没事件且超过阈值 → 判定僵死并重建', () => {
    const logger = makeLogger();
    const rebuild = vi.fn();
    const watch = new ConnectionWatch({ logger, rebuild, now: clock, staleAfterMs: 60_000 });
    watch.markConnected();
    now += 30_000;
    // 首次巡检会先打心跳（lastHeartbeatAt 初始为 0）
    expect(watch.tick()).toBe('heartbeat');
    now += 40_000;
    expect(watch.tick()).toBe('stale-rebuild');
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0]?.[0])).toContain('僵死');
  });

  it('重建之后不重复触发（下次巡检只打心跳）', () => {
    const logger = makeLogger();
    const rebuild = vi.fn();
    const watch = new ConnectionWatch({ logger, rebuild, now: clock, staleAfterMs: 60_000 });
    watch.markConnected();
    now += 61_000;
    watch.tick();
    now += 61_000;
    expect(watch.tick()).not.toBe('stale-rebuild');
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it('收到了事件就不算僵死', () => {
    const logger = makeLogger();
    const rebuild = vi.fn();
    const watch = new ConnectionWatch({ logger, rebuild, now: clock, staleAfterMs: 60_000 });
    watch.markConnected();
    now += 50_000;
    watch.markEvent();
    now += 50_000;
    expect(watch.tick()).not.toBe('stale-rebuild');
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('心跳按间隔打一行状态', () => {
    const logger = makeLogger();
    const watch = new ConnectionWatch({
      logger,
      now: clock,
      heartbeatEveryMs: 10_000,
      staleAfterMs: 600_000,
    });
    watch.markConnected();
    expect(watch.tick()).toBe('heartbeat');
    now += 5_000;
    expect(watch.tick()).toBe('none');
    now += 6_000;
    expect(watch.tick()).toBe('heartbeat');
    const line = String(logger.info.mock.calls[0]?.[0]);
    expect(line).toContain('connected=true');
    expect(line).toContain('lastEvent=never');
  });

  it('断开事件进快照，重连后重新计数事件', () => {
    const watch = new ConnectionWatch({ logger: makeLogger(), now: clock });
    watch.markConnected();
    now += 1_000;
    watch.markEvent();
    now += 1_000;
    watch.markDisconnected(new Error('socket closed'));
    expect(watch.snapshot().connected).toBe(false);
    expect(watch.snapshot().lastError).toBe('socket closed');
    now += 1_000;
    watch.markConnected();
    expect(watch.snapshot().lastEventAt).toBe(null);
  });
});

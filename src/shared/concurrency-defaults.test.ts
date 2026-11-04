import { describe, expect, it } from 'vitest';
import { resolveScopeStrategy } from './concurrency.ts';
import { ConfigSchema } from '../config.ts';

describe('并发策略默认值', () => {
  it('单聊 / 群聊默认「合并」，帖子仍是排队', () => {
    const config = (ConfigSchema as unknown as (input: unknown) => { concurrency: Record<string, string> })({});
    expect(config.concurrency.c2c).toBe('merge');
    expect(config.concurrency.group).toBe('merge');
    expect(config.concurrency.post).toBe('queue');
  });

  it('配置缺字段时的兜底跟 schema 默认一致', () => {
    expect(resolveScopeStrategy({}, 'c2c')).toBe('merge');
    expect(resolveScopeStrategy({}, 'group')).toBe('merge');
    expect(resolveScopeStrategy({}, 'post')).toBe('queue');
  });

  it('显式配置优先', () => {
    expect(resolveScopeStrategy({ concurrency: { group: 'abort' } }, 'group')).toBe('abort');
  });
});

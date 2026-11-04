import { describe, expect, it } from 'vitest';
import { interpretTestResponse } from './probe-result.ts';

describe('interpretTestResponse: 响应翻译成人话', () => {
  it('成功：用服务端给的说明', () => {
    expect(interpretTestResponse(200, { ok: true, detail: '连接正常，鉴权通过' }))
      .toEqual({ ok: true, detail: '连接正常，鉴权通过' });
  });

  it('失败：用服务端给的失败原因', () => {
    expect(interpretTestResponse(200, { ok: false, detail: '鉴权失败（401）：密钥不对或没有权限' }))
      .toEqual({ ok: false, detail: '鉴权失败（401）：密钥不对或没有权限' });
  });

  it('路由不存在（旧进程）→ 明确让人去重启', () => {
    for (const status of [404, 405]) {
      const outcome = interpretTestResponse(status, {});
      expect(outcome.ok).toBe(false);
      expect(outcome.detail).toContain('dsh-restart');
    }
  });

  it('detail 永远不会是 undefined（这就是「✗ undefined」的来源）', () => {
    for (const body of [undefined, null, {}, { ok: false }, { ok: true }, 'oops', 42]) {
      const outcome = interpretTestResponse(200, body);
      expect(typeof outcome.detail).toBe('string');
      expect(outcome.detail.length).toBeGreaterThan(0);
      expect(outcome.detail).not.toContain('undefined');
    }
  });

  it('有 error 字段时优先展示它', () => {
    expect(interpretTestResponse(400, { error: 'kind 只能是 vision 或 image' }).detail)
      .toContain('kind 只能是 vision 或 image');
  });

  it('服务端 500 不会被说成成功', () => {
    const outcome = interpretTestResponse(500, { message: 'gateway boom' });
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('gateway boom');
  });
});

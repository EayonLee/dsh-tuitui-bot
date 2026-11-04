import { describe, it, expect, vi } from 'vitest';
import { commandAllowlistAuth } from './auth.ts';

function makeCtx(senderId: string | undefined, senderAccount?: string): { message: { senderId?: string; senderAccount?: string } } {
  return { message: { senderId, ...(senderAccount !== undefined ? { senderAccount } : {}) } };
}

const allowlist = { access: { c2cMode: 'allowlist' as const, c2cAllow: ['u1', 'u2'] } };

describe('commandAllowlistAuth（#5：命令白名单鉴权，复用审批名单语义）', () => {
  it('allowlist 模式：名单内用户放行', () => {
    expect(commandAllowlistAuth(allowlist)(makeCtx('u1'))).toBe(true);
  });

  it('allowlist 模式：名单外用户拒绝并返回提示', () => {
    const auth = commandAllowlistAuth(allowlist);
    const result = auth(makeCtx('stranger'));
    expect(result).not.toBe(true);
    expect(typeof result).toBe('string');
  });

  it('allowlist 模式：身份缺失 fail-closed', () => {
    const auth = commandAllowlistAuth(allowlist);
    const result = auth(makeCtx(undefined));
    expect(result).not.toBe(true);
  });

  it('open 模式：直接放行（名单不参与）', () => {
    const open = { access: { c2cMode: 'open' as const, c2cAllow: [] } };
    expect(commandAllowlistAuth(open)(makeCtx('anyone'))).toBe(true);
  });

  it('拒绝时记录 warn 日志', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    commandAllowlistAuth(allowlist, logger)(makeCtx('stranger'));
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0]?.[0]).toContain('stranger');
  });

  it('推推双身份：域账号命中名单也放行（名单里两种写法都合法）', () => {
    const auth = commandAllowlistAuth({ access: { c2cMode: 'allowlist', c2cAllow: ['zhangsan'] } });
    expect(auth(makeCtx('uid-9', 'zhangsan'))).toBe(true);
  });

  it('推推双身份：两个标识都不在名单时拒绝', () => {
    const auth = commandAllowlistAuth(allowlist);
    expect(auth(makeCtx('uid-9', 'stranger'))).not.toBe(true);
  });
});

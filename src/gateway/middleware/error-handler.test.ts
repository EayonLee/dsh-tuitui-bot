/**
 * errorHandler 单测 —— 吞异常之后必须结束这条链
 *
 * 背景（#39）：bootstrap 拿到 dispatch 的返回就认为消息「走完了链」，会把同一条
 * 消息再交给正常处理流程。此前 errorHandler 捕获异常后既不 rethrow 也不 skip，
 * 于是用户先收到「处理异常」，紧接着又收到一条正常回答。
 */
import { describe, expect, it } from 'vitest';
import { errorHandler } from './error-handler.ts';
import { MiddlewareKernel } from './kernel.ts';
import { makeCtx } from './test-utils.ts';

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe('errorHandler', () => {
  it('捕获后 skip，下游不再执行、集成方也不会重复处理（#39）', async () => {
    const kernel = new MiddlewareKernel(logger);
    let downstream = 0;
    kernel.use(errorHandler(logger));
    kernel.use(async () => { throw new TypeError('boom'); });
    kernel.use(async () => { downstream += 1; });

    const ctx = makeCtx();
    await kernel.dispatch(ctx);

    expect(ctx.skipped).toBe('error:TypeError');
    expect(downstream).toBe(0);
  });

  it('回复文案照旧，兜底本身再抛异常也不外泄', async () => {
    const sent: string[] = [];
    const kernel = new MiddlewareKernel(logger);
    kernel.use(errorHandler(logger, {
      format: () => {
        throw new Error('format 挂了');
      },
    }));
    kernel.use(async () => { throw new Error('下游挂了'); });

    const ctx = makeCtx();
    await expect(kernel.dispatch(ctx)).resolves.toBeUndefined();
    expect(ctx.skipped).toBe('error:Error');
    expect(sent).toEqual([]);
  });

  it('rethrow=true 时照旧抛出，不 skip', async () => {
    const mw = errorHandler(logger, { rethrow: true });
    const ctx = makeCtx();
    await expect(mw(ctx, async () => { throw new Error('要冒泡'); })).rejects.toThrow('要冒泡');
    expect(ctx.skipped).toBeUndefined();
  });
});

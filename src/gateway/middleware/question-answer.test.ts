import { describe, expect, it, vi } from 'vitest';
import { questionAnswer } from './question-answer.ts';
import { makeCtx, makeMessage, runMiddleware } from './test-utils.ts';

describe('questionAnswer', () => {
  it('没有待答通道时直接放行', async () => {
    const ctx = makeCtx();
    expect((await runMiddleware(questionAnswer({}), ctx)).reachedNext).toBe(true);
  });

  it('问题通道消费成功时跳过后续链路', async () => {
    const ctx = makeCtx(makeMessage({ content: '2' }));
    const { reachedNext } = await runMiddleware(
      questionAnswer({ questionChannel: { answerFromText: () => true } }),
      ctx,
    );

    expect(reachedNext).toBe(false);
    expect(ctx.skipped).toBe('question-answer');
    expect(ctx.state.answeredQuestion).toBe(true);
  });

  it('问题通道未消费时落到审批通道', async () => {
    const ctx = makeCtx(makeMessage({ content: '1' }));
    const { reachedNext } = await runMiddleware(
      questionAnswer({
        questionChannel: { answerFromText: () => false },
        approvalChannel: { answerFromText: () => true },
      }),
      ctx,
    );

    expect(reachedNext).toBe(false);
    expect(ctx.skipped).toBe('approval-answer');
    expect(ctx.state.answeredApproval).toBe(true);
  });

  it('两个通道都没消费时继续走正常链路', async () => {
    const ctx = makeCtx(makeMessage({ content: '今天天气不错' }));
    const { reachedNext } = await runMiddleware(
      questionAnswer({
        questionChannel: { answerFromText: () => false },
        approvalChannel: { answerFromText: () => false },
      }),
      ctx,
    );

    expect(reachedNext).toBe(true);
    expect(ctx.skipped).toBeUndefined();
  });

  it('通道抛异常时按未消费处理，不阻断消息', async () => {
    const warn = vi.fn();
    const ctx = makeCtx(makeMessage({ content: '1' }));
    const { reachedNext } = await runMiddleware(
      questionAnswer(
        {
          questionChannel: {
            answerFromText: () => {
              throw new Error('boom');
            },
          },
        },
        { logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() } },
      ),
      ctx,
    );

    expect(reachedNext).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });
});

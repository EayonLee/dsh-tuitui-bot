/**
 * 错误兜底中间件 — 捕获下游异常，记日志并尽量给用户一个可读的答复
 *
 * 放在链首（最外层洋葱皮），才能看到所有下游阶段（含最终入站处理）的异常。
 * 推推的出站发送本身也可能失败（网络 / 权限），所以「发错误提示」这一步
 * 必须再包一层 try：兜底里再抛异常就真的没人接住了。
 *
 * 默认吞掉异常（不 rethrow）：一次消息处理失败不该让事件循环崩掉，也不该
 * 影响这条连接上的后续消息。
 */
import type { Logger, Middleware, MiddlewareContext } from '../../types.ts';

export interface ErrorHandlerOptions {
  /** 自定义错误文案；返回空串/undefined 表示不回复 */
  format?: (err: Error, ctx: MiddlewareContext) => string | undefined;
  /** 返回 false 的异常不回复也不记日志（如已被 ctx.skip 的常规门控） */
  filter?: (err: Error) => boolean;
  /** 捕获后是否继续抛出（默认 false） */
  rethrow?: boolean;
}

/** 默认文案：不暴露内部错误细节，只告诉用户「出问题了，稍后再试」 */
const DEFAULT_FORMAT = (): string => '⚠️ 处理消息时出现异常，请稍后重试。';

export function errorHandler(logger?: Logger, options: ErrorHandlerOptions = {}): Middleware {
  const format = options.format ?? DEFAULT_FORMAT;
  const filter = options.filter ?? (() => true);
  const rethrow = options.rethrow ?? false;

  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (!filter(error)) {
        if (rethrow) throw error;
        return;
      }

      logger?.error(`[error-handler] 捕获异常: ${error.stack ?? error.message}`);

      try {
        const reply = format(error, ctx);
        if (reply) {
          await ctx.bot.sendMarkdown(ctx.replyTarget, reply);
        }
      } catch (sendErr) {
        // 回复失败不能再抛：兜底层的兜底，只记日志
        logger?.error(
          `[error-handler] 错误提示发送失败: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`,
        );
      }

      if (rethrow) throw error;
      // 已经回过「处理异常」就必须结束这条链：否则集成方会把同一条消息再正常
      // 处理一遍（#39），用户先收到报错、紧接着又收到一条正常回答。
      ctx.skip('error:' + (error.name || 'Error'));
    }
  };
}

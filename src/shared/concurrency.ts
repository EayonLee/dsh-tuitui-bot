/**
 * 「同一会话来第二条消息怎么办」的唯一出处。
 *
 * 两处要用同一套判断：中间件链的并发守卫（管中间件这一段），和入站派发
 * （管真正那一轮 turn）。以前只在中间件里判——而中间件跑完就 release 了，
 * turn 还在跑，于是私聊配了「打断」照样排队。策略得在 turn 这一层也执行。
 */
import type { ConcurrencyStrategy } from '../gateway/middleware/concurrency-guard.ts';
import type { ChatScope } from '../types.ts';

/** 按作用域取策略；配置缺失时按作用域兜底（单聊打断、其余排队） */
export function resolveScopeStrategy(
  config: { concurrency?: Partial<Record<ChatScope, ConcurrencyStrategy>> },
  scope: ChatScope,
): ConcurrencyStrategy {
  const configured = config.concurrency?.[scope];
  if (configured !== undefined) return configured;
  // 兜底与 config 默认值保持一致：单聊 / 群聊攒着合并，帖子仍是排队
  return scope === 'post' ? 'queue' : 'merge';
}

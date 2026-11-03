/**
 * 最近入站 msgId 缓存 — 记录每个 peer 最近收到的消息 id，供"无上下文的出站发送"
 * 拿到引用回复目标。
 *
 * 与上游的差异：QQ 里这份缓存是为了挑一个"还没超频、还没过期"的被动回复目标
 * （换一条能回的消息 id）；推推没有被动回复窗口，这份缓存现在只用来做
 * `referenceMessageId` 的引用回复，以及卡片原地编辑时找回目标消息。
 * 因此 TTL 不再代表平台窗口，只用来避免引用太久以前的消息。
 *
 * 按类型区分：普通消息 msgId 与交互卡片回调 eventId，避免用字符串前缀做隐式
 * 类型判别（上游同样的设计）。
 */
import type { ChatScope } from '../types.ts';

/** 引用目标类型 */
export type ReplyIdKind = 'msg' | 'event';

/** 缓存的引用目标 */
export interface CachedReplyId {
  kind: ReplyIdKind;
  /** msg: 消息 id；event: 交互回调事件 id */
  id: string;
}

interface CachedEntry {
  target: CachedReplyId;
  timestamp: number;
}

const MAX_PER_TARGET = 10;
const TTL_GROUP = 5 * 60 * 1000; // 群聊 5 分钟
const TTL_C2C = 30 * 60 * 1000; // 私聊 30 分钟
const TTL_POST = 30 * 60 * 1000; // 团队帖子 30 分钟
const MAX_TARGETS = 200;
const EVENT_PREFIX = 'INTERACTION_ACTION:';

const cache = new Map<string, CachedEntry[]>();

function cacheKey(scope: ChatScope, targetId: string): string {
  return `${scope}:${targetId}`;
}

function ttlOf(scope: ChatScope): number {
  if (scope === 'group') return TTL_GROUP;
  if (scope === 'post') return TTL_POST;
  return TTL_C2C;
}

function push(scope: ChatScope, targetId: string | undefined, target: CachedReplyId): void {
  if (!scope || !targetId || !target.id) return;
  const key = cacheKey(scope, targetId);
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    existing.push({ target, timestamp: Date.now() });
    if (existing.length > MAX_PER_TARGET) existing.shift();
    cache.set(key, existing);
    return;
  }
  cache.set(key, [{ target, timestamp: Date.now() }]);
  if (cache.size > MAX_TARGETS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** 记录普通消息 msgId */
export function cacheMsgId(scope: ChatScope, targetId: string | undefined, msgId: string | undefined): void {
  if (!msgId) return;
  push(scope, targetId, { kind: 'msg', id: msgId });
}

/** 记录交互回调 eventId（内部拼前缀，便于与 msgId 区分展示） */
export function cacheEventId(scope: ChatScope, targetId: string | undefined, eventId: string | undefined): void {
  if (!eventId) return;
  push(scope, targetId, { kind: 'event', id: `${EVENT_PREFIX}${eventId}` });
}

/** 获取所有未过期的引用目标（按时间倒序，最新在前） */
export function getCachedReplyIds(scope: ChatScope, targetId: string): CachedReplyId[] {
  const list = cache.get(cacheKey(scope, targetId));
  if (!list || list.length === 0) return [];
  const now = Date.now();
  const ttl = ttlOf(scope);
  const result: CachedReplyId[] = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const entry = list[i];
    if (entry !== undefined && now - entry.timestamp < ttl) {
      result.push(entry.target);
    }
  }
  return result;
}

/**
 * 取最近一条未过期的**普通消息** id（引用回复用）。
 *
 * 交互回调的 eventId 不是可引用的消息，故跳过；没有候选时返回 undefined，
 * 调用方据此退化为"不引用、直接发送"。
 */
export function getMsgId(scope: ChatScope, targetId: string): string | undefined {
  for (const candidate of getCachedReplyIds(scope, targetId)) {
    if (candidate.kind === 'msg') return candidate.id;
  }
  return undefined;
}

import { getCachedReplyIds, getMsgId } from "./msgid-cache.js";
/** 帖子目标是否完整（缺 teamId/channelId 无法发帖） */
export function isPostTarget(target) {
    return (target.scope === 'post'
        && typeof target.teamId === 'string'
        && target.teamId.length > 0
        && typeof target.channelId === 'string'
        && target.channelId.length > 0);
}
/**
 * ReplyTarget → 推推 ToTarget。
 *
 * 单聊优先域账号（SDK 的 account 目标支持 modifyText/recall），纯数字才按 uid 处理；
 * 帖子没有 im 目标，返回 null 由调用方改走 teams。
 */
export function resolveToTarget(target) {
    if (target.scope === 'group') {
        return { groupId: target.targetId };
    }
    if (target.scope === 'c2c') {
        const peer = target.targetId;
        if (/^\d+$/.test(peer))
            return { uids: [peer] };
        return { accounts: [peer] };
    }
    return null;
}
/**
 * 解析出站目标。
 *
 * 显式 msgId 必须在缓存窗口内才优先使用：延迟投递（交付物、队列积压）携带的旧
 * id 一旦过期，引用回复会退化成"引用不存在的消息"或被平台拒绝。
 */
export function resolveReplyTarget(target, opts = {}) {
    if (target.scope === 'post') {
        // 帖子回复靠 parentPostId 定位讨论串，不引用 msgid
        return {
            ...target,
            channelId: target.channelId ?? target.targetId,
            msgId: target.postId ?? target.msgId,
        };
    }
    if (opts.allowReference === false) {
        return { ...target, msgId: undefined };
    }
    const cached = getCachedReplyIds(target.scope, target.targetId);
    const explicit = target.msgId;
    if (explicit !== undefined && cached.some((c) => c.kind === 'msg' && c.id === explicit)) {
        return { ...target, msgId: explicit };
    }
    // 显式 id 不在窗口内（或无显式 id）：退到最近一条入站 msgId
    return { ...target, msgId: getMsgId(target.scope, target.targetId) };
}
/**
 * 发送 markdown：解析引用目标（可选节流）后交给发送器。
 *
 * 推推统一走 sendText + referenceMessageId（帖子走 sendPost），因此只保留
 * "解析 + 发送"两步。
 * 命中节流排队时返回空结果（没有 msgId），调用方无需特殊处理。
 */
export async function sendResolvedMarkdown(bot, target, content, opts) {
    const resolved = resolveReplyTarget(target);
    const sender = bot;
    return sender.sendMarkdown(resolved, content, opts);
}
/**
 * 带节流的 markdown 发送（bootstrap 的发送器适配器用）。
 *
 * 把节流放在这一个发送入口，而不是散落在每个调用点：流式降级、工具结果、
 * 交付物清单最终都会经过这里，顺序与间隔由 ReplyLimiter 统一保证。
 */
export async function sendThrottledMarkdown(bot, target, content, opts, limiter) {
    const targetKey = `${target.scope}:${target.targetId}`;
    const result = await limiter.run(targetKey, content, () => sendResolvedMarkdown(bot, target, content, opts));
    // 被去重时 run 返回 undefined：照样返回空结果，调用方不当作失败
    return result ?? {};
}
//# sourceMappingURL=reply-target.js.map
/**
 * 引用解析中间件 — 记录消息 + 解析被引用原文
 *
 * 用户在推推里「回复某条消息」时，事件体带 `data.ref`（被引用消息的正文与附件）。
 * 模型看不到引用关系就答非所问，所以要把引用整理进 `ctx.state.quote`，
 * 由 envelope / 入站组装统一拼进 prompt。
 *
 * 与上游一致地做两件事：
 *   1. **记录**：把当前消息摘要写进可插拔索引（默认内存 LRU），供后到的引用查询；
 *      推推事件里的 ref 有时只有 `shared_post`（被引用的是转发的帖子），
 *      正文要靠这条索引兜底。
 *   2. **解析**：优先用事件体内联的引用数据（最准确、零延迟），索引只做兜底 ——
 *      这点对应上游的 `preferMsgElements`，选项名保持与调用点一致。
 *
 * 截断是必须的：被引用的可能是整篇文档/长代码，原样塞进 prompt 会直接顶爆上下文。
 */
import { truncate } from "../../shared/index.js";
/** 默认内存索引：写满后按插入序淘汰最老的（Map 天然保序） */
export class MemoryRefIndexStore {
    map = new Map();
    maxSize;
    constructor(maxSize = 500) {
        this.maxSize = maxSize;
    }
    get(key) {
        return this.map.get(key);
    }
    set(key, entry) {
        // 覆盖已有 key 时只是「刷新」，不该额外淘汰别人：先删再插同时对齐 LRU 的
        // 「刚用过」语义（原来会先按 size 淘汰掉一条最老的，命中率白丢一次）（#48）
        if (this.map.has(key)) {
            this.map.delete(key);
        }
        else if (this.map.size >= this.maxSize) {
            const oldest = this.map.keys().next().value;
            if (oldest !== undefined)
                this.map.delete(oldest);
        }
        this.map.set(key, entry);
    }
}
/** 内联引用是否带了可用内容（只有 shared_post 时视为「空」） */
function hasInlineContent(reference) {
    if (!reference)
        return false;
    const text = reference.text?.trim() ?? '';
    return text !== '' || (reference.attachments?.length ?? 0) > 0;
}
export function quoteRef(options = {}) {
    const contentLimit = options.contentLimit ?? 500;
    const store = options.store ?? new MemoryRefIndexStore(options.maxSize ?? 500);
    const preferInline = options.preferMsgElements !== false;
    const log = options.logger;
    return async (ctx, next) => {
        const msg = ctx.message;
        // ── 1. 先记录当前消息，供「后到的引用」查询 ──
        if (msg.messageId) {
            let entry = {
                messageId: msg.messageId,
                senderId: msg.senderId,
                senderName: msg.senderName,
                content: truncate(msg.content ?? '', contentLimit),
                timestamp: msg.timestamp,
            };
            if (options.enrichEntry) {
                entry = options.enrichEntry(entry, ctx);
            }
            try {
                await store.set(msg.messageId, entry);
            }
            catch (err) {
                // 记录失败不影响这条消息本身：只是后续引用可能查不到
                log?.warn(`[quote-ref] 写入索引失败: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        // ── 2. 解析引用 ──
        const reference = msg.reference;
        if (!reference) {
            await next();
            return;
        }
        const inlineAvailable = hasInlineContent(reference);
        const refKey = reference.sharedPostId ?? 'inline';
        if (inlineAvailable && preferInline) {
            const resolved = {
                refKey,
                source: 'reference',
                text: truncate(reference.text?.trim() || '[非文本消息]', contentLimit),
                senderName: reference.senderName,
                attachments: reference.attachments,
            };
            if (reference.senderAccount)
                resolved.senderId = reference.senderAccount;
            ctx.state.quote = resolved;
            log?.debug(`[quote-ref] 使用内联引用 refKey=${refKey}`);
            await next();
            return;
        }
        // 内联只有 shared_post / 索引兜底：拿它当键查一下
        const lookupKey = reference.sharedPostId;
        const cached = lookupKey ? await store.get(lookupKey) : undefined;
        if (cached) {
            const resolved = {
                refKey: lookupKey,
                source: 'store',
                text: truncate(cached.content || '[空消息]', contentLimit),
                senderId: cached.senderId,
                senderName: cached.senderName,
            };
            ctx.state.quote = resolved;
            log?.debug(`[quote-ref] 索引命中 refKey=${lookupKey} sender=${cached.senderId}`);
            await next();
            return;
        }
        if (inlineAvailable) {
            // 不优先内联，但索引没命中 → 退回内联数据
            const resolved = {
                refKey,
                source: 'reference',
                text: truncate(reference.text?.trim() || '[非文本消息]', contentLimit),
                senderName: reference.senderName,
                attachments: reference.attachments,
            };
            if (reference.senderAccount)
                resolved.senderId = reference.senderAccount;
            ctx.state.quote = resolved;
            await next();
            return;
        }
        // 什么都没有：记一条空引用，让下游知道「有引用但取不到」
        const empty = { refKey, source: 'none', text: '' };
        ctx.state.quote = empty;
        log?.debug(`[quote-ref] 引用未解析 refKey=${refKey}`);
        await next();
    };
}
//# sourceMappingURL=quote-ref.js.map
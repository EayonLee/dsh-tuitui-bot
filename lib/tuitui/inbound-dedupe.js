/**
 * 入站消息去重（跨重启）
 *
 * SDK 自带去重只在内存里（1000 条 / 20 分钟），进程一重启就清空：重连或
 * 重启后推推把最近的未确认消息再推一遍，机器人就会把同一句话答两遍。
 * 这里把「已处理过的 msgid」落盘，重启后接着用。
 *
 * 只存 id，不存内容；满了按 FIFO 淘汰（默认 1000 条，和 SDK 同量级）。
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const DEFAULT_LIMIT = 1000;
export class InboundDedupe {
    path;
    limit;
    onError;
    /** 顺序数组 + 集合：数组管淘汰顺序，集合管 O(1) 命中 */
    order = [];
    seen = new Set();
    constructor(options = {}) {
        this.path = options.path;
        this.limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
        this.onError = options.onError;
        this.load();
    }
    /** 这条消息是不是已经处理过 */
    has(messageId) {
        if (messageId === undefined || messageId === '')
            return false;
        return this.seen.has(messageId);
    }
    /**
     * 标记为已处理。
     *
     * 返回 true 表示「这次是新的」（可以继续处理），false 表示重复。
     * 先判后记做成一个动作，避免调用方写成两行后漏掉其中一行。
     */
    claim(messageId) {
        if (messageId === undefined || messageId === '')
            return true;
        if (this.seen.has(messageId))
            return false;
        this.seen.add(messageId);
        this.order.push(messageId);
        if (this.order.length > this.limit) {
            const dropped = this.order.splice(0, this.order.length - this.limit);
            for (const id of dropped)
                this.seen.delete(id);
        }
        this.persist();
        return true;
    }
    /** 当前记了多少条（排查用） */
    get size() {
        return this.order.length;
    }
    load() {
        if (this.path === undefined)
            return;
        let raw;
        try {
            raw = readFileSync(this.path, 'utf8');
        }
        catch {
            return; // 没有就是没有，首次运行
        }
        try {
            const parsed = JSON.parse(raw);
            const list = Array.isArray(parsed.seen) ? parsed.seen : [];
            for (const id of list) {
                if (typeof id !== 'string' || id === '' || this.seen.has(id))
                    continue;
                this.seen.add(id);
                this.order.push(id);
            }
            if (this.order.length > this.limit) {
                this.order = this.order.slice(-this.limit);
                this.seen = new Set(this.order);
            }
        }
        catch (err) {
            // 文件坏了不能把插件带死：丢掉重来，只提醒一句
            this.onError?.(`tuitui-seen.json 解析失败，已忽略: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    persist() {
        if (this.path === undefined)
            return;
        try {
            mkdirSync(dirname(this.path), { recursive: true });
            // 先写临时文件再 rename：进程被杀不会留下半截 JSON
            const tmp = `${this.path}.tmp`;
            writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, seen: this.order }), 'utf8');
            renameSync(tmp, this.path);
        }
        catch (err) {
            this.onError?.(`tuitui-seen.json 写入失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
//# sourceMappingURL=inbound-dedupe.js.map
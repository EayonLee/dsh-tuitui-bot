/** SDK 组装消息时用的提及占位符 */
const AT_PLACEHOLDER = /\{\{\s*tuitui_at\s+"[^"]*"\s*\}\}/g;
/** 占位符或裸 @名字（到空白为止），用于剥离开头的一串 @ */
const LEADING_MENTION = /^(?:\{\{\s*tuitui_at\s+"[^"]*"\s*\}\}|@\S+)[\s\u3000]*/;
/** 正文中所有裸 @提及（仅在 stripAllMentions 时使用；与 SDK extractMentions 的边界一致） */
const INLINE_MENTION = /(?<=^|[\s\r\n\u3000、。，！？…])@\S+/g;
/**
 * 折叠空白：普通段落折叠成单空格、连续空行收敛为一个，代码块与引用块原样保留。
 */
function collapseWhitespace(content) {
    const out = [];
    let inFence = false;
    let blankPending = false;
    const flushBlank = () => {
        if (blankPending) {
            out.push('');
            blankPending = false;
        }
    };
    for (const raw of content.split('\n')) {
        // 代码围栏：开合都要按原样保留，且围栏内一律不处理
        if (/^\s*(?:`{3,}|~{3,})/.test(raw)) {
            inFence = !inFence;
            flushBlank();
            out.push(raw);
            continue;
        }
        if (inFence) {
            out.push(raw);
            continue;
        }
        // 引用块与缩进代码块：只去行尾空白，行内不动
        if (/^\s*>/.test(raw) || /^(?: {4,}|\t)/.test(raw)) {
            flushBlank();
            out.push(raw.replace(/[ \t]+$/, ''));
            continue;
        }
        const collapsed = raw.replace(/[\t ]+/g, ' ').trim();
        if (collapsed === '') {
            blankPending = true;
            continue;
        }
        flushBlank();
        out.push(collapsed);
    }
    return out.join('\n');
}
export function contentSanitizer(options = {}) {
    const { stripBotMention = true, stripAllMentions = false, collapseWhitespace: shouldCollapse = true, transform, } = options;
    const log = options.logger;
    return async (ctx, next) => {
        const original = ctx.message.content ?? '';
        let content = original;
        // 占位符是协议语法，永远不是用户想说的话，无条件清掉
        content = content.replace(AT_PLACEHOLDER, '');
        if (stripAllMentions) {
            content = content.replace(INLINE_MENTION, '');
        }
        else if (stripBotMention && ctx.message.atMe === true) {
            // 只剥离开头连续的一串：中间出现的 @某人 是对话内容，不能动
            while (LEADING_MENTION.test(content)) {
                content = content.replace(LEADING_MENTION, '');
            }
        }
        if (shouldCollapse) {
            content = collapseWhitespace(content);
        }
        content = content.trim();
        if (transform) {
            content = transform(content, ctx);
        }
        if (content !== original) {
            log?.debug(`[content-sanitizer] 正文清洗 ${original.length} → ${content.length} 字符`);
            ctx.message.content = content;
        }
        await next();
    };
}
//# sourceMappingURL=content-sanitizer.js.map
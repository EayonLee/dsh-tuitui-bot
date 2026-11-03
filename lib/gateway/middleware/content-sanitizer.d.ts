/**
 * 内容清洗中间件 — 把入站正文整理成适合喂给模型的干净文本
 *
 * 推推入站的 text 会带两类噪音：
 *   1. 提及占位符 `{{tuitui_at "张三"}}`（SDK 组装消息时的原生占位语法）；
 *   2. 群聊/帖子里开头的 `@机器人`（只要本条消息 at_me，开头那串 @ 基本就是机器人）。
 * 不清理的话，模型会把 `@大肥鱼 /bot-help` 当成正文的一部分，命令与意图判断都会漂。
 *
 * ⚠️ 折叠空白必须绕开代码块与引用块：用户把一段代码贴进来问「哪里错了」时，
 * 把缩进/换行折成一行会直接毁掉问题本身。
 */
import type { Logger, Middleware, MiddlewareContext } from '../../types.ts';
export interface ContentSanitizerOptions {
    /** 去掉开头的 @机器人（本条 at_me 时生效），默认 true */
    stripBotMention?: boolean;
    /** 去掉正文里所有 @提及，默认 false（默认保留，模型需要知道有人在对话谁） */
    stripAllMentions?: boolean;
    /** 折叠多余空白（代码块/引用块内不折叠），默认 true */
    collapseWhitespace?: boolean;
    /**
     * QQ 专有的表情标签解析开关。
     *
     * 上游拿它处理 `[<face,id=xx/>]` 与 `<faceType=..,ext="..">`；推推的消息体里没有
     * 这种标记，因此这里保留字段只是为了不改动上游的调用点（middleware-setup 照抄了
     * `{ parseFaceTags: true }`），实际不做任何事。
     */
    parseFaceTags?: boolean;
    /** 兜底自定义变换，在全部内置清洗之后执行 */
    transform?: (content: string, ctx: MiddlewareContext) => string;
    logger?: Logger;
}
export declare function contentSanitizer(options?: ContentSanitizerOptions): Middleware;
//# sourceMappingURL=content-sanitizer.d.ts.map
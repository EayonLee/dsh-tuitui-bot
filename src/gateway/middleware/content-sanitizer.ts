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

/** SDK 组装消息时用的提及占位符 */
const AT_PLACEHOLDER = /\{\{\s*tuitui_at\s+"[^"]*"\s*\}\}/g;
/** 占位符或裸 @名字（到空白为止），用于剥离开头的一串 @ */
const LEADING_MENTION = /^(?:\{\{\s*tuitui_at\s+"[^"]*"\s*\}\}|@\S+)[\s\u3000]*/;
/** 正文中所有裸 @提及（仅在 stripAllMentions 时使用；与 SDK extractMentions 的边界一致） */
const INLINE_MENTION = /(?<=^|[\s\r\n\u3000、。，！？…])@\S+/g;

/**
 * 折叠空白：普通段落折叠成单空格、连续空行收敛为一个，代码块与引用块原样保留。
 */
function collapseWhitespace(content: string): string {
  const out: string[] = [];
  let inFence = false;
  let blankPending = false;

  const flushBlank = (): void => {
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

export function contentSanitizer(options: ContentSanitizerOptions = {}): Middleware {
  const {
    stripBotMention = true,
    stripAllMentions = false,
    collapseWhitespace: shouldCollapse = true,
    transform,
  } = options;
  const log = options.logger;

  return async (ctx, next) => {
    const original = ctx.message.content ?? '';
    let content = original;

    // 占位符是协议语法，永远不是用户想说的话，无条件清掉
    content = content.replace(AT_PLACEHOLDER, '');

    if (stripAllMentions) {
      content = content.replace(INLINE_MENTION, '');
    } else if (stripBotMention && ctx.message.atMe === true) {
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

/**
 * 推推表情名称解析
 *
 * 实测结论（对着线上接口一个个试出来的，不是照着文档猜的）：
 * `/message/custom/modify` 的 `emoji_reaction.emoji` 只认**推推内置表情的名字**，
 * 而且这个集合很小、很自家化（微笑 / 大笑 / 强 / 弱 / 牛 / 赞 / 鼓掌 / 奶茶 / 蛋糕 …）。
 *
 *   emoji: '👀'   → errcode 1「不合法的emoji表情」
 *   emoji: '难过' → errcode 1「不合法的emoji表情」（QQ 那套名字这里并不通用）
 *   emoji: '微笑' → errcode 0
 *
 * 也就是说任何 unicode emoji、以及不在内置表里的名字，都会被服务端一句
 * "不合法的emoji表情"拒掉——以前这行日志还是 debug 级，于是「表情回执没效果」
 * 在日志里一个字都查不到。这里做三件事：
 *
 *   1. 常见 unicode 映射成**验证过可用**的名字（老配置里的 👀 / ✅ / 👍 还能用）
 *   2. 名字形态的输入原样透传，交给服务端裁决
 *   3. 认不出来的 unicode 返回 null，让调用方明确告警，而不是发一个必然失败的请求
 */

/** 已实测可用的表情名（服务端没有列出接口，这份是抓出来的样本，不是全集） */
export const KNOWN_EMOJI_NAMES = [
  '微笑', '大笑', '强', '弱', '牛', '赞', '鼓掌', '抱拳', '握手',
  '玫瑰', '太阳', '爱心', '心碎', '庆祝', '疑问', '委屈',
  '感谢', '加油', '咖啡', '困', '奶茶', '蛋糕', '啤酒',
  '收到', '好的', 'OK',
] as const;

/**
 * unicode → 推推表情名。
 *
 * 只映射**已经验证过服务端认的名字**：映射到不存在的名字等于换个姿势失败，
 * 比不映射更糟（用户以为自己填对了）。
 */
const UNICODE_ALIASES: Readonly<Record<string, string>> = {
  '👀': '微笑',
  '😊': '微笑',
  '🙂': '微笑',
  '✅': 'OK',
  '✔️': 'OK',
  '✔': 'OK',
  '👍': '强',
  '👎': '弱',
  '❤️': '爱心',
  '❤': '爱心',
  '💔': '心碎',
  '🙏': '抱拳',
  '🤝': '握手',
  '👏': '鼓掌',
  '🎉': '庆祝',
  '🌹': '玫瑰',
  '☀️': '太阳',
  '☀': '太阳',
  '😕': '疑问',
  '😵': '委屈',
};

/** 名称形态：中文 / 英数 / 下划线连字符，且不含空白 */
const NAME_LIKE = /^[\p{Script=Han}A-Za-z0-9_+\-]+$/u;

/**
 * 把配置里写的表情转成推推认识的名字。
 *
 * @returns 合法的表情名；空串表示"不挂表情"；null 表示认不出来（别发请求）
 */
export function resolveTuituiEmoji(input: string | undefined | null): string | null {
  const raw = (input ?? '').trim();
  if (raw === '') return '';
  if (NAME_LIKE.test(raw)) return raw;
  const alias = UNICODE_ALIASES[raw];
  if (alias !== undefined) return alias;
  // 带变体选择符 / 组合 emoji 的情况：先去掉再试一次
  const stripped = raw.replace(/\uFE0F/g, '').trim();
  if (stripped !== raw && NAME_LIKE.test(stripped)) return stripped;
  const strippedAlias = UNICODE_ALIASES[stripped];
  if (strippedAlias !== undefined) return strippedAlias;
  return null;
}

/** 面板里当提示用的常用名（服务端才是权威，不在这里做白名单拦截） */
export const COMMON_EMOJI_NAMES = KNOWN_EMOJI_NAMES;

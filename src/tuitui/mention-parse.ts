/**
 * 从正文里认出 `@某某`，换成推推要的 at 元数据。
 *
 * 推推的「真 @」不是正文里的字符，而是发送时带上 `at: ['域账号或姓名']`。
 * 只在文本里写 @名字，对方收不到通知，别的机器人也看不见——那等于没喊。
 * 所以发消息前把正文里的 @ 解析出来，跟调用方显式给的 at 合并。
 *
 * 只做保守识别：代码块/行内代码里的 @ 不算，邮箱域名不算，@all 不算。
 */
const MENTION_PATTERN = /(?:^|[\s，。、；：！？,.;:!?（(\[【"'「])@([\p{Script=Han}A-Za-z0-9_·\-（）()]{1,24})/gu;

/** 这些不是人，@ 了也没意义 */
const RESERVED = new Set(['all', 'everyone', 'here', '全体', '所有人']);

function stripCode(text: string): string {
  // 围栏代码块 + 行内代码都先抹成空格，避免把代码里的 @ 当成提到谁
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

/** 名字尾部可能粘上标点，剪掉 */
function trimName(raw: string): string {
  return raw.replace(/[.。,，;；:：!！?？、]+$/u, '').trim();
}

/**
 * 解析正文里的 @。
 *
 * @param text 待发送的正文（Markdown）
 * @param options.self 自己的名字，出现 `@自己` 时忽略（没必要 @ 自己）
 * @param options.max 最多返回几个，默认 5
 */
export function extractMentions(text: string, options: { self?: string; max?: number } = {}): string[] {
  if (text === '' || !text.includes('@')) return [];
  const max = Math.max(1, options.max ?? 5);
  const source = stripCode(text);
  const found: string[] = [];
  for (const match of source.matchAll(MENTION_PATTERN)) {
    const name = trimName(match[1] ?? '');
    if (name === '') continue;
    // 后面紧跟着「.xxx」的多半是邮箱/域名（@163.com / a@b.cn），不当作提到某人。
    // 名字本身不含点，所以要在匹配之后再往后看一个字符。
    const after = source[(match.index ?? 0) + match[0].length];
    if (after === '.' && /[A-Za-z0-9]/.test(source[(match.index ?? 0) + match[0].length + 1] ?? '')) continue;
    // 带点的多半是邮箱/域名（a@b.com），不当作提到某人
    if (name.includes('.')) continue;
    if (RESERVED.has(name.toLowerCase())) continue;
    if (options.self !== undefined && name === options.self) continue;
    if (!found.includes(name)) found.push(name);
    if (found.length >= max) break;
  }
  return found;
}

/** 合并显式 at 与正文解析结果（显式优先，去重，限流） */
export function mergeMentions(explicit: string[] | undefined, text: string, options: { self?: string } = {}): string[] {
  const fromText = extractMentions(text, options);
  const merged: string[] = [];
  for (const name of [...(explicit ?? []), ...fromText]) {
    if (name === '' || merged.includes(name)) continue;
    merged.push(name);
    if (merged.length >= 5) break;
  }
  return merged;
}

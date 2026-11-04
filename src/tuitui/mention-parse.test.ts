import { describe, it, expect } from 'vitest';
import { extractMentions, mergeMentions } from './mention-parse.ts';

describe('extractMentions', () => {
  it('认出中文昵称，包括带括号的', () => {
    expect(extractMentions('@另一个机器人 你听见没')).toEqual(['另一个机器人']);
    expect(extractMentions('@小助手（研发组） 说话')).toEqual(['小助手（研发组）']);
  });

  it('句尾标点不粘进名字', () => {
    expect(extractMentions('行吧 @另一个机器人。')).toEqual(['另一个机器人']);
    expect(extractMentions('@A、@B 都来')).toEqual(['A', 'B']);
  });

  it('邮箱和域名不算提到谁', () => {
    expect(extractMentions('发到 a@b.com')).toEqual([]);
    expect(extractMentions('@163.com 这种不算')).toEqual([]);
  });

  it('代码块和行内代码里的 @ 不算', () => {
    expect(extractMentions('看这段：`@not-a-human`')).toEqual([]);
    expect(extractMentions('\`\`\`\n@inside\n\`\`\`')).toEqual([]);
  });

  it('@all 这类不算，自己的名字也不算', () => {
    expect(extractMentions('@all 集合')).toEqual([]);
    expect(extractMentions('@小助手 自言自语', { self: '小助手' })).toEqual([]);
  });

  it('去重并限流', () => {
    expect(extractMentions('@A @A @B')).toEqual(['A', 'B']);
    expect(extractMentions('@1 @2 @3 @4 @5 @6 @7', { max: 3 })).toEqual(['1', '2', '3']);
  });
});

describe('mergeMentions', () => {
  it('显式 at 优先且去重', () => {
    expect(mergeMentions(['zhangsan'], '@zhangsan @lisi 来')).toEqual(['zhangsan', 'lisi']);
  });

  it('没有显式 at 时只用正文里的', () => {
    expect(mergeMentions(undefined, '@lisi 来')).toEqual(['lisi']);
  });

  it('最多 5 个', () => {
    expect(mergeMentions(['a', 'b', 'c', 'd', 'e'], '@f')).toHaveLength(5);
  });
});

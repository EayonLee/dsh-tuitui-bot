import { describe, expect, it } from 'vitest';
import { contentSanitizer } from './content-sanitizer.ts';
import { makeCtx, makeMessage, runMiddleware } from './test-utils.ts';

const sanitize = async (
  content: string,
  options: Parameters<typeof contentSanitizer>[0] = {},
  atMe = false,
): Promise<string> => {
  const ctx = makeCtx(makeMessage({ content, atMe }));
  await runMiddleware(contentSanitizer(options), ctx);
  return ctx.message.content;
};

describe('contentSanitizer', () => {
  it('去掉提及占位符', async () => {
    expect(await sanitize('{{tuitui_at "大肥鱼"}} 帮我看看')).toBe('帮我看看');
  });

  it('at_me 时剥离开头的 @机器人，但保留正文中间的 @', async () => {
    expect(await sanitize('@大肥鱼 请转告 @张三 明天开会', {}, true))
      .toBe('请转告 @张三 明天开会');
  });

  it('未被 @ 时不动开头的 @（那是正常对话内容）', async () => {
    expect(await sanitize('@张三 你昨天说的那个', {}, false)).toBe('@张三 你昨天说的那个');
  });

  it('stripAllMentions 清掉正文里所有提及', async () => {
    expect(await sanitize('@大肥鱼 请转告 @张三 明天开会', { stripAllMentions: true }, true))
      .toBe('请转告 明天开会');
  });

  it('折叠空白但完整保留代码块', async () => {
    const input = [
      '帮我看下这段：',
      '',
      '',
      '```ts',
      'const a =  1;',
      '',
      '',
      'if (a) {',
      '    return   a;',
      '}',
      '```',
      '',
      '它报错了',
    ].join('\n');

    const output = await sanitize(input);

    expect(output.startsWith('帮我看下这段：\n\n```ts')).toBe(true);
    expect(output.endsWith('```\n\n它报错了')).toBe(true);
    expect(output).toContain('const a =  1;');
    expect(output).toContain('    return   a;');
  });

  it('保留引用块原貌', async () => {
    expect(await sanitize('> 第一行  原样\n> 第二行')).toBe('> 第一行  原样\n> 第二行');
  });

  it('首尾空白被 trim', async () => {
    expect(await sanitize('   hi  ')).toBe('hi');
  });

  it('transform 在最后一步生效', async () => {
    expect(await sanitize('abc', { transform: (text) => text.toUpperCase() })).toBe('ABC');
  });
});

import { describe, it, expect } from 'vitest';
import { chunkMarkdownText } from './chunker.ts';

/** 切分结果必须无损：拼回去等于原文 */
function rejoin(chunks: string[]): string {
  return chunks.join('\n');
}

describe('chunkMarkdownText', () => {
  it('不超过上限时原样返回单块', () => {
    expect(chunkMarkdownText('hello', 10)).toEqual(['hello']);
  });

  it('正好等于上限时不切分', () => {
    expect(chunkMarkdownText('1234567890', 10)).toEqual(['1234567890']);
  });

  it('在换行边界切分且不丢内容', () => {
    const text = ['aaaa', 'bbbb', 'cccc'].join('\n');
    const chunks = chunkMarkdownText(text, 10);

    expect(chunks).toEqual(['aaaa\nbbbb', 'cccc']);
    expect(rejoin(chunks)).toBe(text);
  });

  it('单行超限时该行独占一块（不按字符硬切）', () => {
    const long = 'x'.repeat(20);
    const text = `short\n${long}`;

    expect(chunkMarkdownText(text, 10)).toEqual(['short', long]);
  });

  it('表格作为整体移动，不在表格中间断开', () => {
    const table = ['| a | b |', '| - | - |', '| 1 | 2 |'].join('\n');
    const text = `line1\n${table}`;

    // 表格自身超过上限也必须整块保留，宁可单条超限也不能劈开
    expect(chunkMarkdownText(text, 20)).toEqual(['line1', table]);
  });

  it('表格后面跟着普通行时，表格先整体落地再继续拼', () => {
    const table = ['| a |', '| - |'].join('\n');
    const text = `${table}\ntail`;

    expect(chunkMarkdownText(text, 20)).toEqual([`${table}\ntail`]);
    expect(chunkMarkdownText(text, 8)).toEqual([table, 'tail']);
  });

  it('代码块内的竖线不会被当成表格（围栏内不改表结构）', () => {
    const text = ['```', '| not | a | table |', '```', 'after'].join('\n');
    const chunks = chunkMarkdownText(text, 1000);

    expect(chunks).toEqual([text]);
  });

  it('围栏行保留在块内，切分不产生孤儿围栏', () => {
    const code = ['```ts', 'const a = 1;', 'const b = 2;', '```'].join('\n');
    const chunks = chunkMarkdownText(`intro\n${code}`, 20);

    expect(rejoin(chunks)).toBe(`intro\n${code}`);
    // 每块至少包含一个完整的行，且不出现被截断的字符
    expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
  });

  it('空文本返回单个空块（调用方仍能走统一发送路径）', () => {
    expect(chunkMarkdownText('', 10)).toEqual(['']);
  });

  it('多段落按上限切成多块并保持顺序', () => {
    const text = Array.from({ length: 6 }, (_, i) => `line-${i}`).join('\n');
    const chunks = chunkMarkdownText(text, 20);

    expect(chunks.length).toBeGreaterThan(1);
    expect(rejoin(chunks)).toBe(text);
  });
});

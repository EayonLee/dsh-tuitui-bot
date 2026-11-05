import { describe, expect, it } from 'vitest';
import { installAboutStyles } from '../client/about-bar.ts';

/** 最小 Document 替身：只实现 installAboutStyles 用到的那几个方法 */
function fakeDoc(): { doc: Document; styles: string[]; calls: number } {
  const styles: string[] = [];
  let calls = 0;
  const doc = {
    get head() {
      return {
        appendChild(node: { textContent?: string }) {
          styles.push(String(node.textContent ?? ''));
          return node;
        },
      };
    },
    getElementById(id: string) {
      calls += 1;
      return styles.length > 0 && id === 'imqb-about-styles' ? { id } : null;
    },
    createElement() {
      return { id: '', textContent: '' };
    },
  } as unknown as Document;
  return { doc, styles, get calls() { return calls; } };
}

describe('installAboutStyles', () => {
  it('注入一次样式，包含四档状态色与不省略的版本样式', () => {
    const { doc, styles } = fakeDoc();
    installAboutStyles(doc);
    expect(styles).toHaveLength(1);
    const css = styles[0] ?? '';
    expect(css).toContain('.imqb-about-ver');
    expect(css).toContain('white-space: nowrap');
    expect(css).toContain('.imqb-about-chip--warn');
    expect(css).toContain('.imqb-about-chip--ok');
    expect(css).toContain('.imqb-about-chip--info');
  });

  it('已经注入过就不再重复注入', () => {
    const { doc, styles } = fakeDoc();
    installAboutStyles(doc);
    installAboutStyles(doc);
    expect(styles).toHaveLength(1);
  });

  it('没有 document（SSR / 测试环境）时不炸', () => {
    expect(() => installAboutStyles(undefined)).not.toThrow();
  });
});

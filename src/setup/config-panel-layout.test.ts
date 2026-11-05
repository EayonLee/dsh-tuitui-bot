/**
 * 配置页的区块顺序与导航一致性。
 *
 * 背景（issue #12）：「智能判断」是「触发方式 = 智能」的细化配置，却排在
 * 「表情回执」后面，还得靠条件渲染出现；导航里的顺序又和正文对不上，
 * 点一下会跳到风马牛不相及的地方。
 *
 * 客户端组件没法在 node 环境里真渲染，所以这里退一步做源码断言：
 * 顺序、常驻渲染、置灰标记这三件事都盯住。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../client/config-panel.ts', import.meta.url), 'utf8');

/** 正文里各 Section 出现的顺序 */
function sectionOrder(): string[] {
  const ids = [...source.matchAll(/createElement\(Section, \{\s*\n\s*id: '([a-z]+)'/g)].map((m) => m[1]);
  return ids.filter((id): id is string => id !== undefined);
}

/** 左侧模块导航的顺序 */
function navOrder(): string[] {
  const start = source.indexOf('const modules = [');
  const end = source.indexOf('];', start);
  expect(start).toBeGreaterThan(-1);
  const block = source.slice(start, end);
  return [...block.matchAll(/id: '([a-z]+)'/g)]
    .map((m) => m[1])
    .filter((id): id is string => id !== undefined);
}

describe('配置页区块顺序（issue #12）', () => {
  it('「智能判断」紧跟「回话方式」，位于「表情回执」之前', () => {
    const order = sectionOrder();
    expect(order.indexOf('smart')).toBe(order.indexOf('reply') + 1);
    expect(order.indexOf('smart')).toBeLessThan(order.indexOf('reaction'));
  });

  it('导航顺序与正文顺序完全一致', () => {
    expect(navOrder()).toEqual(sectionOrder());
  });

  it('导航里始终有「智能判断」，不再随触发方式隐藏', () => {
    expect(navOrder()).toContain('smart');
    expect(source).not.toMatch(/policy === 'smart' \? \[\{ id: 'smart'/);
  });
});

describe('智能判断：常驻 + 置灰，而不是条件渲染', () => {
  it('不再用三元表达式整个拿掉这一块', () => {
    expect(source).not.toMatch(/policy === 'smart'\s*\n\s*\? createElement\(Section/);
  });

  it('非智能模式下置灰并说明原因', () => {
    expect(source).toMatch(/muted: policy !== 'smart'/);
    expect(source).toMatch(/仅智能模式生效/);
  });

  it('置灰区块保留交互阻断样式，避免聚焦到禁用控件', () => {
    expect(source).toMatch(/\.imqb2-card--muted \.imqb2-rows \{ pointer-events: none/);
    expect(source).toMatch(/\.imqb2-card--muted \{ opacity/);
  });
});

describe('回话方式：「忙的时候」单独成组', () => {
  it('三个忙时选项都在小标题之后', () => {
    const subhead = source.indexOf('忙的时候');
    expect(subhead).toBeGreaterThan(-1);
    for (const key of ["concurrency.c2c", "concurrency.group", "concurrency.post"]) {
      expect(source.indexOf(key)).toBeGreaterThan(subhead);
    }
  });
});

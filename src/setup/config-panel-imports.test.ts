/**
 * 回归：客户端用到的常量必须真的 import 进来。
 *
 * 事故现场：`fetch(TEST_MODEL_PATH)` 写在组件里，但 import 漏了。
 * 根 tsconfig 不覆盖 src/client，于是 tsc 全绿、构建也过，页面一点就
 * 报「TEST_MODEL_PATH is not defined」。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../client/config-panel.ts', import.meta.url), 'utf8');

describe('config-panel 的常量与类型来源', () => {
  it('引用 TEST_MODEL_PATH 就必须从 shared/bind-protocol.ts 引入', () => {
    const withoutImports = source.replace(/import[^;]+;/g, '');
    if (!/\bTEST_MODEL_PATH\b/.test(withoutImports)) return;
    expect(source).toMatch(/import \{[^}]*\bTEST_MODEL_PATH\b[^}]*\} from '\.\.\/shared\/bind-protocol\.ts'/);
  });

  it('扁平配置类型直接继承服务端的 ConfigPatchWire，不手抄', () => {
    expect(source).toMatch(/interface ConfigWire extends ConfigPatchWire/);
    expect(source).not.toMatch(/interface ConfigWire\s*\{/);
  });
});

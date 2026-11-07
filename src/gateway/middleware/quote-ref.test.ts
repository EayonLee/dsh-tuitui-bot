/**
 * 引用索引 LRU 的容量语义（#48）
 *
 * 覆盖写（同一个 messageId 再来一次）只是刷新，不该额外淘汰别人；
 * 满了才淘汰最老的那条。
 */
import { describe, it, expect } from 'vitest';
import { MemoryRefIndexStore } from './quote-ref.ts';

const entry = (text: string) => ({ messageId: text, text }) as never;

describe('MemoryRefIndexStore', () => {
  it('覆盖已有 key 不会多淘汰一条（#48）', () => {
    const store = new MemoryRefIndexStore(2);
    store.set('a', entry('A'));
    store.set('b', entry('B'));
    store.set('b', entry('B2')); // 刷新，不该把 a 挤掉

    expect(store.get('a')).toBeDefined();
    expect(store.get('b')).toBeDefined();

    store.set('c', entry('C')); // 这时才淘汰最老的 a
    expect(store.get('a')).toBeUndefined();
    expect(store.get('b')).toBeDefined();
    expect(store.get('c')).toBeDefined();
  });

  it('刷新后该 key 变成最新，后续淘汰从别的 key 开始', () => {
    const store = new MemoryRefIndexStore(2);
    store.set('a', entry('A'));
    store.set('b', entry('B'));
    store.set('a', entry('A2'));

    store.set('c', entry('C'));
    expect(store.get('a')).toBeDefined();
    expect(store.get('b')).toBeUndefined();
  });
});

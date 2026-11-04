import { describe, it, expect } from 'vitest';
import { historyBuffer } from './history-buffer.ts';
import { MemoryHistoryStore } from '../../features/history-store.ts';
import type { MiddlewareContext } from '../../types.ts';
import { makeCtx, makeMessage } from './test-utils.ts';

function setup() {
  const store = new MemoryHistoryStore();
  const mirror = new MemoryHistoryStore();
  const mw = historyBuffer({ limit: 50, store, mirrorStore: mirror });
  return { store, mirror, mw };
}

function groupCtx(text: string, msgId: string): MiddlewareContext {
  return makeCtx(makeMessage({ groupId: 'g-1', content: text, messageId: msgId }));
}

describe('historyBuffer + mirrorStore', () => {
  it('主存储清空后，镜像仍留着判定要的上下文', async () => {
    const { store, mirror, mw } = setup();

    await mw(groupCtx('第一句', 'm1'), async () => {});
    await mw(groupCtx('第二句', 'm2'), async () => {});

    store.clear('g-1'); // 回复后普通历史被清空

    expect(store.list('g-1', 50)).toHaveLength(0);
    expect(mirror.list('g-1', 50).map((e) => e.content)).toEqual(['第一句', '第二句']);
  });

  it('单聊不记历史，镜像也不记', async () => {
    const { mirror, mw } = setup();

    await mw(makeCtx(makeMessage({ scope: 'c2c', content: '私聊一句', messageId: 'm3' })), async () => {});

    expect(mirror.list('g-1', 50)).toHaveLength(0);
  });

  it('同一条消息重投不会在镜像里记两遍', async () => {
    const { mirror, mw } = setup();

    await mw(groupCtx('同一句', 'm4'), async () => {});
    await mw(groupCtx('同一句', 'm4'), async () => {});

    expect(mirror.list('g-1', 50)).toHaveLength(1);
  });
});

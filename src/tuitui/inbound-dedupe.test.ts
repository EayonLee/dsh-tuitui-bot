import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboundDedupe } from './inbound-dedupe.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tuitui-dedupe-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('InboundDedupe', () => {
  it('同一个 msgid 只认一次', () => {
    const dedupe = new InboundDedupe();
    expect(dedupe.claim('m-1')).toBe(true);
    expect(dedupe.claim('m-1')).toBe(false);
    expect(dedupe.has('m-1')).toBe(true);
  });

  it('空 msgid 不参与去重（多条无 id 事件不能被吞）', () => {
    const dedupe = new InboundDedupe();
    expect(dedupe.claim(undefined)).toBe(true);
    expect(dedupe.claim(undefined)).toBe(true);
    expect(dedupe.claim('')).toBe(true);
  });

  it('重启后还能认出处理过的消息', () => {
    const path = join(dir, 'seen.json');
    const first = new InboundDedupe({ path });
    expect(first.claim('m-keep')).toBe(true);
    expect(existsSync(path)).toBe(true);

    const second = new InboundDedupe({ path });
    expect(second.claim('m-keep')).toBe(false);
    expect(second.claim('m-new')).toBe(true);
  });

  it('超上限按 FIFO 淘汰，文件里也不会无限长', () => {
    const path = join(dir, 'seen.json');
    const dedupe = new InboundDedupe({ path, limit: 3 });
    for (const id of ['a', 'b', 'c', 'd']) dedupe.claim(id);
    expect(dedupe.size).toBe(3);
    expect(dedupe.has('a')).toBe(false);
    expect(dedupe.has('d')).toBe(true);
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { seen: string[] };
    expect(raw.seen).toEqual(['b', 'c', 'd']);
  });

  it('文件损坏不影响启动，只回调一次错误', () => {
    const path = join(dir, 'seen.json');
    writeFileSync(path, '{ not json', 'utf8');
    const errors: string[] = [];
    const dedupe = new InboundDedupe({ path, onError: (m) => errors.push(m) });
    expect(dedupe.claim('m-1')).toBe(true);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('解析失败');
  });
});

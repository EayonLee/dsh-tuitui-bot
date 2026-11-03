import { describe, it, expect } from 'vitest';
import { parseEvent, parseStreamFrame, type RawSessionEvent } from './events.ts';

/** 构造 agent/assistant-stream 的 payload（帧字段按宿主 AssistantStreamFrame 形态） */
function payload(frame: unknown, agentId = 'sess-tuitui'): unknown {
  return { agent: { id: agentId }, frame };
}

describe('parseStreamFrame', () => {
  it('start 帧归一化为空串增量（新 attempt 边界）', () => {
    expect(parseStreamFrame(payload({ type: 'start', attemptId: 'a1', revision: 1, turn: 1, step: 1 })))
      .toEqual({ agentId: 'sess-tuitui', delta: '' });
  });

  it('text-delta chunk 归一化为文本增量', () => {
    expect(parseStreamFrame(payload({
      type: 'chunk', attemptId: 'a1', revision: 1, index: 0, time: 1,
      chunk: { type: 'text-delta', index: 0, text: 'hi' },
    }))).toEqual({ agentId: 'sess-tuitui', delta: 'hi' });
  });

  it.each([
    ['reasoning-delta', { type: 'reasoning-delta', index: 0, text: '思考' }],
    ['tool-call-delta', { type: 'tool-call-delta', index: 1, id: 'c1', argumentsDelta: '{}' }],
    ['block-start', { type: 'block-start', index: 0, blockType: 'text' }],
    ['finish', { type: 'finish', reason: { kind: 'stop' } }],
  ])('忽略非文本 %s chunk', (_name, chunk) => {
    expect(parseStreamFrame(payload({ type: 'chunk', attemptId: 'a1', chunk }))).toBeUndefined();
  });

  it('忽略 end 帧（收尾由 durable assistant/message / turn/end 负责）', () => {
    expect(parseStreamFrame(payload({
      type: 'end', attemptId: 'a1',
      outcome: { kind: 'committed', eventType: 'assistant/message', seq: 3 },
    }))).toBeUndefined();
  });

  it.each([
    ['null', null],
    ['非对象', 'x'],
    ['缺 agent', { frame: { type: 'start', attemptId: 'a1' } }],
    ['缺 agent.id', { agent: {}, frame: { type: 'start', attemptId: 'a1' } }],
    ['缺 frame', { agent: { id: 'sess-tuitui' } }],
    ['frame 为 null', { agent: { id: 'sess-tuitui' }, frame: null }],
    ['缺 attemptId', { agent: { id: 'sess-tuitui' }, frame: { type: 'start' } }],
    ['未知帧类型', { agent: { id: 'sess-tuitui' }, frame: { type: 'future', attemptId: 'a1' } }],
    ['空 text-delta', { agent: { id: 'sess-tuitui' }, frame: { type: 'chunk', attemptId: 'a1', chunk: { type: 'text-delta', text: '' } } }],
  ])('非法输入返回 undefined：%s', (_name, raw) => {
    expect(parseStreamFrame(raw)).toBeUndefined();
  });
});

describe('parseEvent', () => {
  const sessionEvent = (type: string, data: unknown): RawSessionEvent => ({
    type,
    data: data as Record<string, unknown>,
  });

  it('assistant/chunk 只保留 text-delta', () => {
    expect(parseEvent(sessionEvent('assistant/chunk', { chunk: { type: 'text-delta', text: 'hi' } })))
      .toEqual({ type: 'assistant/chunk', text: 'hi' });
    expect(parseEvent(sessionEvent('assistant/chunk', { chunk: { type: 'reasoning-delta', text: 'x' } })))
      .toBeUndefined();
  });

  it('tool/call 缺 callId 或 name 时忽略', () => {
    expect(parseEvent(sessionEvent('tool/call', { callId: 'c1', name: 'bash' })))
      .toEqual({ type: 'tool/call', callId: 'c1', name: 'bash', arguments: '' });
    expect(parseEvent(sessionEvent('tool/call', { name: 'bash' }))).toBeUndefined();
  });

  it('tool/result 从 message.source.callId 取调用 id', () => {
    const parsed = parseEvent(sessionEvent('tool/result', {
      message: { source: { callId: 'c1' } },
      error: { name: 'Error', code: 'E_BAD' },
    }));
    expect(parsed).toMatchObject({ type: 'tool/result', callId: 'c1', error: { name: 'Error', code: 'E_BAD' } });
  });

  it('turn/end 缺 reason 时用空对象兜底', () => {
    expect(parseEvent(sessionEvent('turn/end', {}))).toEqual({ type: 'turn/end', reason: {} });
  });
});

describe('parseEvent: deliverables/presented', () => {
  const presented = (data: unknown): RawSessionEvent => ({ type: 'deliverables/presented', data: data as Record<string, unknown> });
  const file = (path: string, description?: string) => (description === undefined ? { path } : { path, description });

  it('合法事件解析为强类型（含可选 description）', () => {
    expect(parseEvent(presented({ turn: 3, callId: 'call-1', files: [file('/tmp/a.png'), file('/tmp/b.md', '说明')] })))
      .toEqual({
        type: 'deliverables/presented',
        turn: 3,
        callId: 'call-1',
        files: [{ path: '/tmp/a.png' }, { path: '/tmp/b.md', description: '说明' }],
      });
  });

  it.each([
    ['缺 turn', { callId: 'c', files: [file('a')] }],
    ['turn 非 number', { turn: '3', callId: 'c', files: [file('a')] }],
    ['缺 callId', { turn: 1, files: [file('a')] }],
    ['callId 为空串', { turn: 1, callId: '', files: [file('a')] }],
    ['缺 files', { turn: 1, callId: 'c' }],
    ['files 为空数组', { turn: 1, callId: 'c', files: [] }],
    ['files 非数组', { turn: 1, callId: 'c', files: 'x' }],
    ['文件项缺 path', { turn: 1, callId: 'c', files: [{ description: 'd' }] }],
    ['path 为空串', { turn: 1, callId: 'c', files: [file('')] }],
    ['description 非 string', { turn: 1, callId: 'c', files: [{ path: 'a', description: 1 }] }],
    ['文件项为 null', { turn: 1, callId: 'c', files: [null] }],
  ])('非法事件返回 undefined：%s', (_name, data) => {
    expect(parseEvent(presented(data))).toBeUndefined();
  });
});

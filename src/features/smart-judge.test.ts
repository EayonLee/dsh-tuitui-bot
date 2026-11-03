/**
 * 智能插话判定的单元测试。
 *
 * 用假 llm 模拟各种模型行为（正常 JSON / 纯文本 / 抛错 / 超时），
 * 核对「失败一律不插嘴」这条底线不被任何分支破坏。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSmartJudgeCooldowns, judgeShouldJoin, DEFAULT_SMART_PROMPT } from './smart-judge.ts';

type Chunk = { type: 'text-delta'; index: number; text: string } | { type: 'finish'; reason: 'stop' };

/** 造一个只回一段文本的 llm */
function fakeLlm(text: string) {
  return {
    stream: () => (async function* generate(): AsyncGenerator<Chunk> {
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'finish', reason: 'stop' };
    })(),
  };
}

/** 造一个直接抛错的 llm */
function throwingLlm() {
  return {
    stream: () => (async function* generate(): AsyncGenerator<Chunk> {
      throw new Error('upstream down');
      yield { type: 'finish', reason: 'stop' };
    })(),
  };
}

const base = {
  route: { provider: 'p', model: 'm' },
  history: [{ sender: '张三', text: '今天天气不错' }],
  message: { sender: '李四', text: '憨包，帮我看下这个报错' },
} as const;

afterEach(() => {
  clearSmartJudgeCooldowns();
  vi.useRealTimers();
});

describe('judgeShouldJoin', () => {
  it('模型说 join 就插嘴', async () => {
    const result = await judgeShouldJoin({ ...base, llm: fakeLlm('{"join":true,"why":"在叫我"}') });
    expect(result.join).toBe(true);
    expect(result.reason).toBe('在叫我');
  });

  it('模型说不要就闭嘴', async () => {
    const result = await judgeShouldJoin({ ...base, llm: fakeLlm('{"join":false,"why":"别人在聊"}') });
    expect(result.join).toBe(false);
  });

  it('JSON 包在代码块/多余文字里也能解析', async () => {
    const result = await judgeShouldJoin({ ...base, llm: fakeLlm('好的\n```json\n{"join":true}\n```') });
    expect(result.join).toBe(true);
  });

  it('模型只回单词 true 时按插嘴处理', async () => {
    const result = await judgeShouldJoin({ ...base, llm: fakeLlm('true') });
    expect(result.join).toBe(true);
    expect(result.reason).toBe('fallback-text');
  });

  it('输出无法解析时不插嘴', async () => {
    const result = await judgeShouldJoin({ ...base, llm: fakeLlm('我觉得可以但是不确定') });
    expect(result.join).toBe(false);
    expect(result.reason).toBe('unparsable');
  });

  it('stream 抛错不插嘴', async () => {
    const result = await judgeShouldJoin({ ...base, llm: throwingLlm() });
    expect(result.join).toBe(false);
    expect(result.reason).toBe('error');
  });

  it('llm 缺失时不插嘴', async () => {
    const result = await judgeShouldJoin({ ...base, llm: undefined });
    expect(result.join).toBe(false);
    expect(result.reason).toBe('llm-unavailable');
  });

  it('路线缺失时不插嘴', async () => {
    const result = await judgeShouldJoin({ ...base, route: undefined, llm: fakeLlm('{"join":true}') });
    expect(result.join).toBe(false);
  });

  it('provider/model 为空视为不可用', async () => {
    const result = await judgeShouldJoin({
      ...base, route: { provider: '', model: '' }, llm: fakeLlm('{"join":true}'),
    });
    expect(result.join).toBe(false);
  });

  it('冷却窗口内不再调用模型', async () => {
    const spy = vi.fn(() => (async function* generate(): AsyncGenerator<Chunk> {
      yield { type: 'text-delta', index: 0, text: '{"join":true}' };
      yield { type: 'finish', reason: 'stop' };
    })());
    const llm = { stream: spy };
    const first = await judgeShouldJoin({ ...base, llm, cooldownKey: 'g1', cooldownMs: 60000 });
    expect(first.join).toBe(true);
    const second = await judgeShouldJoin({ ...base, llm, cooldownKey: 'g1', cooldownMs: 60000 });
    expect(second.join).toBe(false);
    expect(second.reason).toBe('cooldown');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('不同会话各自独立冷却', async () => {
    const llm = fakeLlm('{"join":true}');
    await judgeShouldJoin({ ...base, llm, cooldownKey: 'g1', cooldownMs: 60000 });
    const other = await judgeShouldJoin({ ...base, llm, cooldownKey: 'g2', cooldownMs: 60000 });
    expect(other.join).toBe(true);
  });

  it('clearSmartJudgeCooldowns 立刻解冻', async () => {
    const llm = fakeLlm('{"join":true}');
    await judgeShouldJoin({ ...base, llm, cooldownKey: 'g1', cooldownMs: 60000 });
    clearSmartJudgeCooldowns();
    const again = await judgeShouldJoin({ ...base, llm, cooldownKey: 'g1', cooldownMs: 60000 });
    expect(again.join).toBe(true);
  });

  it('自定义提示词会替换出厂默认', async () => {
    let seen = '';
    const llm = {
      stream: (options: { messages: Array<{ content: Array<{ text?: string }> }> }) => {
        seen = options.messages[0]?.content[0]?.text ?? '';
        return (async function* generate(): AsyncGenerator<Chunk> {
          yield { type: 'text-delta', index: 0, text: '{"join":false}' };
          yield { type: 'finish', reason: 'stop' };
        })();
      },
    };
    await judgeShouldJoin({ ...base, llm, prompt: '只回一句话的时候才插嘴' });
    expect(seen).toContain('只回一句话的时候才插嘴');
    expect(seen).not.toContain(DEFAULT_SMART_PROMPT.slice(0, 20));
  });

  it('提示词为空串时回落到出厂默认', async () => {
    let seen = '';
    const llm = {
      stream: (options: { messages: Array<{ content: Array<{ text?: string }> }> }) => {
        seen = options.messages[0]?.content[0]?.text ?? '';
        return (async function* generate(): AsyncGenerator<Chunk> {
          yield { type: 'text-delta', index: 0, text: '{"join":false}' };
          yield { type: 'finish', reason: 'stop' };
        })();
      },
    };
    await judgeShouldJoin({ ...base, llm, prompt: '   ' });
    expect(seen).toContain(DEFAULT_SMART_PROMPT.slice(0, 20));
  });
});

import { describe, expect, it } from 'vitest';
import { KNOWN_EMOJI_NAMES, resolveTuituiEmoji } from './emoji.ts';

describe('resolveTuituiEmoji: 推推只认内置表情名', () => {
  it('中文名 / ASCII 名原样透传（交给服务端裁决）', () => {
    for (const name of ['微笑', 'OK', '抱拳', '奶茶', '赞']) {
      expect(resolveTuituiEmoji(name)).toBe(name);
    }
  });

  it('老配置里的 unicode 兜底翻译成已验证可用的名字', () => {
    expect(resolveTuituiEmoji('👀')).toBe('微笑');
    expect(resolveTuituiEmoji('✅')).toBe('OK');
    expect(resolveTuituiEmoji('👍')).toBe('强');
    expect(resolveTuituiEmoji('😵')).toBe('委屈');
  });

  it('带变体选择符也能认', () => {
    expect(resolveTuituiEmoji('❤️')).toBe('爱心');
    expect(resolveTuituiEmoji('✔️')).toBe('OK');
  });

  it('空串表示不挂表情', () => {
    expect(resolveTuituiEmoji('')).toBe('');
    expect(resolveTuituiEmoji('   ')).toBe('');
    expect(resolveTuituiEmoji(undefined)).toBe('');
    expect(resolveTuituiEmoji(null)).toBe('');
  });

  it('认不出来的 emoji 返回 null', () => {
    expect(resolveTuituiEmoji('🦄')).toBeNull();
    expect(resolveTuituiEmoji('🎈')).toBeNull();
  });

  it('前后空白会被裁掉', () => {
    expect(resolveTuituiEmoji('  微笑 ')).toBe('微笑');
  });

  it('别名表里只允许出现已验证可用的名字（防止映射成不存在的表情）', () => {
    const verified = new Set<string>([...KNOWN_EMOJI_NAMES, 'ok']);
    for (const emoji of ['👀', '😊', '🙂', '✅', '✔️', '👍', '👎', '❤️', '💔', '🙏', '🤝', '👏', '🎉', '🌹', '☀️', '😕', '😵']) {
      const name = resolveTuituiEmoji(emoji);
      expect(verified.has(name as string)).toBe(true);
    }
  });
});

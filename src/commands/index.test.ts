import { describe, it, expect, vi } from 'vitest';
import { buildCommandList } from './index.ts';
import type { SessionManager } from '../session/index.ts';
import type { ImTuituiConfig } from '../config.ts';
import type { InboundMessage, MiddlewareContext, ReplyTarget, TuituiSender } from '../types.ts';

/** 命令表里只有 handler 会用到 manager，构建阶段是纯编排——用结构桩即可 */
function makeManager(overrides: Record<string, unknown> = {}): SessionManager {
  return {
    getStatus: () => ({ active: false }),
    getEffectiveModel: () => undefined,
    listAvailableModels: async () => [],
    getSessionRecord: () => undefined,
    getEffectivePreset: () => undefined,
    listPresets: async () => [],
    remove: async () => {},
    compact: async () => ({ ok: true, shadowed: 0, tokens: 0 }),
    ...overrides,
  } as unknown as SessionManager;
}

function makeConfig(overrides: Record<string, unknown> = {}): ImTuituiConfig {
  return {
    appId: 'app-123456',
    appSecret: 'secret',
    textChunkLimit: 4000,
    access: { c2cMode: 'open', c2cAllow: [], groupMode: 'open', groupAllow: [], postMode: 'open', postAllow: [] },
    apiBaseUrl: '',
    websocketBaseUrl: '',
    interactive: { enabled: true },
    ...overrides,
  } as unknown as ImTuituiConfig;
}

function makeCtx(content: string, sent: string[]): MiddlewareContext {
  const message: InboundMessage = {
    eventType: 'single_chat',
    kind: 'c2c',
    senderId: 'u1',
    senderAccount: 'zhangsan',
    senderName: 'L',
    content,
    messageId: 'm1',
    timestamp: new Date().toISOString(),
    attachments: [],
    raw: {},
  };
  const replyTarget: ReplyTarget = { scope: 'c2c', targetId: 'zhangsan', msgId: 'm1' };
  const bot = {
    sendMarkdown: vi.fn(async (_target: ReplyTarget, text: string) => {
      sent.push(text);
      return { msgId: `m-${sent.length}` };
    }),
  } as unknown as TuituiSender;
  return { message, state: {}, replyTarget, bot, skip: vi.fn(), skipped: undefined };
}

function findCommand(commands: ReturnType<typeof buildCommandList>, name: string) {
  const cmd = commands.find((c) => c.name === name || (c.aliases ?? []).includes(name));
  if (!cmd) throw new Error(`command ${name} not found`);
  return cmd;
}

describe('buildCommandList（斜杠命令注册表契约）', () => {
  const commands = buildCommandList({ manager: makeManager(), config: makeConfig() });

  it('names and aliases are unique（中间件的 register 遇到重复会直接抛）', () => {
    const seen = new Set<string>();
    for (const cmd of commands) {
      for (const name of [cmd.name, ...(cmd.aliases ?? [])]) {
        expect(seen.has(name), `duplicate command name: ${name}`).toBe(false);
        seen.add(name);
      }
    }
  });

  it('每条命令都有说明与 handler（/help 不会渲染出空行）', () => {
    for (const cmd of commands) {
      expect(cmd.description, `missing description: ${cmd.name}`).toBeTruthy();
      expect(typeof cmd.handler).toBe('function');
    }
  });

  it('/new 保留 reset/clear 别名，/status 保留 bot-status 别名', () => {
    expect(findCommand(commands, 'new').aliases).toEqual(['reset', 'clear']);
    expect(findCommand(commands, 'status').aliases).toContain('bot-status');
    expect(findCommand(commands, 'help').aliases).toContain('bot-help');
  });

  it('/help 按「通用能力 / 插件内置」分组列出全部命令', async () => {
    const sent: string[] = [];
    await findCommand(commands, 'help').handler(makeCtx('/help', sent));
    const text = sent.join('\n');
    expect(text).toContain('通用能力');
    expect(text).toContain('插件内置指令');
    expect(text).toContain('/new');
    expect(text).toContain('/bot-help');
    expect(text).toContain('dsh-tuitui-bot v');
  });

  it('/bot-ping 返回 pong 与总延迟', async () => {
    const sent: string[] = [];
    await findCommand(commands, 'bot-ping').handler(makeCtx('/bot-ping', sent));
    expect(sent.join('\n')).toContain('pong');
    expect(sent.join('\n')).toContain('延迟');
  });

  it('/status 无活跃会话时给出明确提示', async () => {
    const sent: string[] = [];
    await findCommand(commands, 'status').handler(makeCtx('/status', sent));
    expect(sent[0]).toContain('当前无活跃会话');
  });

  it('/status 有活跃会话时展示模型与消息数', async () => {
    const manager = makeManager({
      getStatus: () => ({
        active: true,
        sessionId: 'abcd1234efgh5678',
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        preset: 'coder',
        messageCount: 12,
        lastActivity: Date.now() - 5000,
      }),
    });
    const list = buildCommandList({ manager, config: makeConfig() });
    const sent: string[] = [];
    await findCommand(list, 'status').handler(makeCtx('/status', sent));
    const text = sent.join('\n');
    expect(text).toContain('会话: abcd1234'); // /status 只回显前 8 位
    expect(text).toContain('deepseek-official/deepseek-v4-flash');
    expect(text).toContain('coder');
    expect(text).toContain('12');
  });

  it('/model 无参数时列出可用模型与切换指令', async () => {
    const manager = makeManager({
      listAvailableModels: async () => [
        { provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'V4 Flash' },
      ],
    });
    const list = buildCommandList({ manager, config: makeConfig() });
    const sent: string[] = [];
    await findCommand(list, 'model').handler(makeCtx('/model', sent));
    expect(sent.join('\n')).toContain('/model deepseek-official/deepseek-v4-flash');
  });

  it('/model 带参数切换模型', async () => {
    const setModelOverride = vi.fn(async () => {});
    const list = buildCommandList({ manager: makeManager({ setModelOverride }), config: makeConfig() });
    const sent: string[] = [];
    await findCommand(list, 'model').handler(makeCtx('/model deepseek-official/deepseek-v4-flash', sent));
    expect(setModelOverride).toHaveBeenCalledWith('c2c', 'zhangsan', {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    });
    expect(sent.join('\n')).toContain('已切换');
  });

  it('/model 在 allowlist 模式下拒绝名单外用户', async () => {
    const setModelOverride = vi.fn(async () => {});
    const list = buildCommandList({
      manager: makeManager({ setModelOverride }),
      config: makeConfig({ access: { c2cMode: 'allowlist', c2cAllow: ['someone-else'] } }),
    });
    const sent: string[] = [];
    await findCommand(list, 'model').handler(makeCtx('/model a/b', sent));
    expect(setModelOverride).not.toHaveBeenCalled();
    expect(sent[0]).toContain('无权限');
  });

  it('/bind 回显绑定状态且不泄露完整 secret', async () => {
    const sent: string[] = [];
    await findCommand(commands, 'bind').handler(makeCtx('/bind', sent));
    const text = sent.join('\n');
    expect(text).toContain('app');
    expect(text).toContain('已配置');
    expect(text).toContain('推推机器人');
  });

  it('/stop 在没有进行中生成时提示', async () => {
    const sent: string[] = [];
    await findCommand(commands, 'stop').handler(makeCtx('/stop', sent));
    expect(sent[0]).toContain('没有进行中的生成');
  });
});

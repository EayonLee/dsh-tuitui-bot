import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TuituiShortcutCommand } from '@qihoo/tuitui-bot-sdk';
import { TuituiBotClient } from '@qihoo/tuitui-bot-sdk';
import type { ImTuituiConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import {
  createSdkLogger,
  createTuituiClient,
  describeApiError,
  extractMessageId,
  resolveEndpoints,
} from './client.ts';
import { DEFAULT_SHORTCUTS, syncShortcutCommands } from './shortcut.ts';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } satisfies Logger;
}

function makeConfig(over: Partial<ImTuituiConfig> = {}): ImTuituiConfig {
  return { appId: 'app-1', appSecret: 'secret', debug: false, ...over } as unknown as ImTuituiConfig;
}

/** 假 SDK：只保留 property.setShortcutCommands，记录传入参数 */
function createPropertyClient(failure?: unknown) {
  const calls: Array<readonly TuituiShortcutCommand[]> = [];
  const client = {
    property: {
      setShortcutCommands: async (commands: readonly TuituiShortcutCommand[]) => {
        calls.push(commands);
        if (failure !== undefined) throw failure;
        return {};
      },
    },
  };
  return { client: client as unknown as TuituiBotClient, calls };
}

function shortcutApiError() {
  return Object.assign(new Error('forbidden'), {
    endpoint: '/property/shortcut',
    status: 403,
    response: { trans_id: 't-9' },
  });
}

const ENV_KEYS = ['TUITUI_BOT_API_BASE', 'TUITUI_BOT_WS_BASE'] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('resolveEndpoints', () => {
  it('未配置且无环境变量时返回空对象（走 SDK 默认生产地址）', () => {
    const endpoints = resolveEndpoints(makeConfig());

    expect(endpoints).toEqual({});
    expect(endpoints).not.toHaveProperty('apiBaseUrl');
    expect(endpoints).not.toHaveProperty('websocketBaseUrl');
  });

  it('配置值去掉首尾空白与结尾斜杠', () => {
    const endpoints = resolveEndpoints(makeConfig({
      apiBaseUrl: '  https://api.example.com///  ',
      websocketBaseUrl: 'wss://ws.example.com/',
    }));

    expect(endpoints).toEqual({
      apiBaseUrl: 'https://api.example.com',
      websocketBaseUrl: 'wss://ws.example.com',
    });
  });

  it('__FROM_ENV__ 占位与 process.env 写法都从环境变量取值', () => {
    process.env.TUITUI_BOT_API_BASE = 'https://env.example.com/';
    process.env.TUITUI_BOT_WS_BASE = ' wss://env-ws.example.com ';

    const endpoints = resolveEndpoints(makeConfig({
      apiBaseUrl: '__FROM_ENV__',
      websocketBaseUrl: 'process.env.TUITUI_BOT_WS_BASE',
    }));

    expect(endpoints).toEqual({
      apiBaseUrl: 'https://env.example.com',
      websocketBaseUrl: 'wss://env-ws.example.com',
    });
  });

  it('显式配置优先于环境变量', () => {
    process.env.TUITUI_BOT_API_BASE = 'https://env.example.com';

    const endpoints = resolveEndpoints(makeConfig({ apiBaseUrl: 'https://own.example.com' }));

    expect(endpoints.apiBaseUrl).toBe('https://own.example.com');
  });

  it('配置只有空白时视为未配置，也不会误用环境变量', () => {
    process.env.TUITUI_BOT_API_BASE = 'https://env.example.com';

    expect(resolveEndpoints(makeConfig({ apiBaseUrl: '   ' }))).toEqual({});
  });
});

describe('createSdkLogger', () => {
  it('debug=false 不透传 SDK debug 日志，其余级别加 [tuitui] 前缀', () => {
    const logger = createLogger();
    const sdkLogger = createSdkLogger(logger, false);

    sdkLogger.info('hello');
    sdkLogger.warn('warn', { a: 1 });
    sdkLogger.error('boom');

    expect(sdkLogger).not.toHaveProperty('debug');
    expect(logger.info).toHaveBeenCalledWith('[tuitui] hello', '');
    expect(logger.warn).toHaveBeenCalledWith('[tuitui] warn', { a: 1 });
    expect(logger.error).toHaveBeenCalledWith('[tuitui] boom', '');
  });

  it('debug=true 时 debug 也转发', () => {
    const logger = createLogger();
    const sdkLogger = createSdkLogger(logger, true);

    sdkLogger.debug?.('detail', 'ctx');

    expect(logger.debug).toHaveBeenCalledWith('[tuitui] detail', 'ctx');
  });
});

describe('extractMessageId', () => {
  it('从 msgid/msg_id/post_id/msgids[0].msgid 取值', () => {
    expect(extractMessageId({ msgid: 'm-1' })).toBe('m-1');
    expect(extractMessageId({ msg_id: 'm-2' })).toBe('m-2');
    expect(extractMessageId({ post_id: 'p-1' })).toBe('p-1');
    expect(extractMessageId({ postid: 'p-2' })).toBe('p-2');
    expect(extractMessageId({ msgids: [{ msgid: 'm-3' }] })).toBe('m-3');
  });

  it('非对象、空值、数字 msgid、空数组一律返回 undefined', () => {
    expect(extractMessageId(null)).toBeUndefined();
    expect(extractMessageId('m-1')).toBeUndefined();
    expect(extractMessageId({})).toBeUndefined();
    expect(extractMessageId({ msgid: '' })).toBeUndefined();
    expect(extractMessageId({ msgid: 123 })).toBeUndefined();
    expect(extractMessageId({ msgids: [] })).toBeUndefined();
    expect(extractMessageId({ msgids: [{ msgid: 1 }] })).toBeUndefined();
  });
});

describe('describeApiError', () => {
  it('字符串/基本值直接转字符串', () => {
    expect(describeApiError('plain error')).toBe('plain error');
    expect(describeApiError(null)).toBe('null');
  });

  it('完整错误对象带 endpoint/status/errcode 与 response 里的 trans_id/errmsg', () => {
    const error = Object.assign(new Error('boom'), {
      endpoint: '/im/send_text',
      status: 502,
      errcode: 4001,
      response: { trans_id: 't-1', errmsg: 'upstream busy' },
    });

    expect(describeApiError(error)).toBe(
      'boom | endpoint=/im/send_text | status=502 | errcode=4001 | trans_id=t-1 | errmsg=upstream busy',
    );
  });

  it('没有 response 时不塞 trans_id', () => {
    const error = Object.assign(new Error('boom'), { endpoint: '/im/recall', status: 500 });

    const text = describeApiError(error);

    expect(text).toBe('boom | endpoint=/im/recall | status=500');
    expect(text).not.toContain('trans_id');
  });
});

describe('syncShortcutCommands', () => {
  it('空指令表直接返回 false，不调用 SDK', async () => {
    const { client, calls } = createPropertyClient();
    const logger = createLogger();

    await expect(syncShortcutCommands(client, [], logger)).resolves.toBe(false);

    expect(calls).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('成功时全量下发同一份指令表并记 info', async () => {
    const { client, calls } = createPropertyClient();
    const logger = createLogger();

    const ok = await syncShortcutCommands(client, DEFAULT_SHORTCUTS, logger);

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(DEFAULT_SHORTCUTS);
    expect(logger.info).toHaveBeenCalledWith(`shortcut commands synced (${DEFAULT_SHORTCUTS.length})`);
  });

  it('SDK 抛错时返回 false 并记录完整错误', async () => {
    const { client } = createPropertyClient(shortcutApiError());
    const logger = createLogger();

    const ok = await syncShortcutCommands(client, DEFAULT_SHORTCUTS, logger);

    expect(ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const warnText = String(logger.warn.mock.calls[0]?.[0]);
    expect(warnText).toContain('shortcut command sync failed');
    expect(warnText).toContain('forbidden');
    expect(warnText).toContain('trans_id=t-9');
  });

  it('默认指令表内容自洽：内容以 / 开头、name 唯一', () => {
    expect(DEFAULT_SHORTCUTS).toHaveLength(7);
    expect(DEFAULT_SHORTCUTS.every((command) => command.content.startsWith('/'))).toBe(true);
    expect(new Set(DEFAULT_SHORTCUTS.map((command) => command.name)).size).toBe(DEFAULT_SHORTCUTS.length);
    expect(DEFAULT_SHORTCUTS.find((command) => command.name === 'help')?.content).toBe('/bot-help');
  });
});

describe('createTuituiClient', () => {
  it('构造真实 SDK 客户端并记录 UA 日志', () => {
    const logger = createLogger();

    const client = createTuituiClient(makeConfig(), logger);

    expect(client).toBeInstanceOf(TuituiBotClient);
    expect(typeof client.im.sendText).toBe('function');
    expect(typeof client.teams.sendPost).toBe('function');
    expect(typeof client.property.setShortcutCommands).toBe('function');
    expect(logger.info).toHaveBeenCalledTimes(1);
    const logText = String(logger.info.mock.calls[0]?.[0]);
    expect(logText).toContain('tuitui client initialized');
    expect(logText).toContain('UA=dsh-tuitui-bot/');
  });
});

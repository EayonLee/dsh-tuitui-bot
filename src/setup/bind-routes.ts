/**
 * 端内绑定页路由 — /tuitui/im-tuitui/bind
 *
 * 注册在 dsh-host-webserver（ctx.webServer）的具名路由：
 * - Web 模式：页面同源直接访问
 * - Desktop：渲染进程的 fetch 经 IPC 桥自动附加 Host 认证转发
 *
 * 响应只含脱敏的 appId 与机器人回显信息；appSecret 绝不出现在任何响应中。
 * manual/verify 提交走与绑定流程一致的校验 + persist 路径
 * （写入 profile patch → HMR 重载生效）。
 *
 * 推推无扫码，因此没有 refresh 路由；verify 路由供绑定页「先校验再保存」，
 * 避免把错误凭据写进 profile 触发一次失败的重载。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Schema from '@deepseek-ai/schemastery';
import type { ImTuituiConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { BindingService, VerifyOutcome } from './binding-service.ts';
import { verifyTuituiCredentials } from './binding-service.ts';
import {
  persistCredentialsToProfile,
  removeCredentialsFromProfile,
  updateProfileConfig,
  type SetupCredentials,
} from './persist.ts';
import { getProfileDir } from '../shared/index.ts';
import {
  BIND_CONFIG_PATH,
  BIND_MANUAL_PATH,
  BIND_STATE_PATH,
  BIND_UNBIND_PATH,
  BIND_VERIFY_PATH,
  TEST_MODEL_PATH,
  type BindStateWire,
  type TestModelResponse,
} from '../shared/bind-protocol.ts';
import { probeEndpoint } from '../media/openai-compat.ts';

// 协议单一来源：shared/bind-protocol.ts（类型 + 路径常量，客户端共用）
export { BIND_CONFIG_PATH, BIND_MANUAL_PATH, BIND_STATE_PATH, BIND_UNBIND_PATH, BIND_VERIFY_PATH, TEST_MODEL_PATH };
export type { BindStateWire };

/** dsh-host-webserver 的具名路由注册形状（局部投影，避免硬依赖） */
export interface WebRoute {
  kind: 'exact' | 'prefix';
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

/** ctx.webServer 的局部投影（服务可用性由调用方探测） */
export interface WebServerLike {
  register(route: WebRoute): () => void;
}

/** 手动凭据提交的处理结果 */
export interface ManualSubmitResult {
  /** 是否已持久化（false = 落盘失败，需展示手动配置指引） */
  persisted: boolean;
  /** 失败原因（persisted=false 时回传给表单展示） */
  error?: string;
  /** 成功提示（缺省用统一文案） */
  message?: string;
}

/** 解绑处理结果 */
export interface UnbindResult {
  persisted: boolean;
  error?: string;
}

/** 已绑定态（已配置凭据的 fiber 注入；null 表示未绑定） */
export type BoundStateFn = () => Extract<BindStateWire, { phase: 'bound' }> | null;

/** 路由行为注入 */
export interface BindRoutesOptions {
  /**
   * 已绑定态：返回脱敏的 appId 与机器人回显（可回显，非机密），null 表示未绑定。
   * 已绑定 fiber 注册路由时提供；待绑定流程不提供。
   */
  boundState?: BoundStateFn;
  /** 手动凭据提交处理（默认：在线校验 + persist 到 profile patch） */
  onManualCredentials?: (credentials: SetupCredentials) => Promise<ManualSubmitResult>;
  /** 仅校验不落盘（默认：临时客户端调 property.info） */
  onVerify?: (credentials: SetupCredentials) => Promise<VerifyOutcome>;
  /** 解绑处理（默认：移除 profile patch 中的凭据字段 + 清进程 env） */
  onUnbind?: () => UnbindResult;
  /** 当前生效配置（apply 时 loader 合并后的值，GET 回显用） */
  currentConfig?: () => ImTuituiConfig;
  /** 配置写入（默认：最小合并写入 profile patch） */
  onUpdateConfig?: (patch: Record<string, unknown>) => boolean;
}

/** 访问模式三值（与 config.ts 的 AccessControlConfig 一致） */
const AccessModeSchema = Schema.union(['open', 'allowlist', 'blocklist', 'disabled']);

function booleanSchema(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${name} 必须是布尔值`);
  return value;
}

function stringSchema(name: string): (value: unknown) => unknown {
  return (value) => {
    if (typeof value !== 'string') throw new TypeError(`${name} 必须是字符串`);
    if (value.length > 20000) throw new TypeError(`${name} 过长`);
    return value;
  };
}

function numberSchema(name: string, min: number, max: number): (value: unknown) => unknown {
  return (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} 必须是数字`);
    if (value < min || value > max) throw new TypeError(`${name} 超出允许范围（${min}~${max}）`);
    return value;
  };
}

function accessModeSchema(name: string): (value: unknown) => unknown {
  return (value) => {
    try {
      return AccessModeSchema(value as never);
    } catch {
      throw new TypeError(`${name} 必须是 open / allowlist / blocklist / disabled`);
    }
  };
}

/** 名单类字段：字符串数组，逐项 trim、去空、去重，限制条数与单条长度 */
function stringListSchema(value: unknown, name: string): unknown {
  if (!Array.isArray(value)) throw new TypeError(`${name} 必须是字符串数组`);
  if (value.length > 500) throw new TypeError(`${name} 条数过多（最多 500）`);
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new TypeError(`${name} 的每一项都必须是字符串`);
    const trimmed = item.trim();
    if (trimmed === '') continue;
    if (trimmed.length > 200) throw new TypeError(`${name} 单项过长（最多 200 字符）`);
    if (!result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

/** smart 竞态判定用的三个值 */
/** 表情：允许空串（表示不挂），最多 8 个字符（一个 emoji 可能占多个 UTF-16 单元） */
function emojiSchema(value: unknown, name: string): unknown {
  if (typeof value !== 'string') throw new TypeError(`${name} 必须是字符串`);
  const trimmed = value.trim();
  if (trimmed.length > 8) throw new TypeError(`${name} 最多 8 个字符`);
  return trimmed;
}

const CONCURRENCY_STRATEGIES = ['queue', 'drop', 'abort', 'merge'] as const;

function strategySchema(value: unknown, name: string): unknown {
  if (typeof value !== 'string' || !(CONCURRENCY_STRATEGIES as readonly string[]).includes(value)) {
    throw new TypeError(`${name} 必须是 queue / drop / abort / merge`);
  }
  return value;
}

function mentionPolicySchema(value: unknown): unknown {
  if (value !== 'require' && value !== 'always' && value !== 'smart') {
    throw new TypeError('mentionPolicy 必须是 require / always / smart');
  }
  return value;
}

/**
 * 可经 UI 编辑的配置键（白名单：只收用户必要的字段，其余走 patch/env）。
 *
 * 键名与 shared/bind-protocol.ts 的 ConfigPatchWire 一一对应；含点号的键
 * 读/写都按嵌套路径处理（access.c2cMode → config.access.c2cMode），
 * 因此改一个子项不会把父对象的其余子项固化成字面量。
 */
const EDITABLE_CONFIG_KEYS = [
  'provider', 'model', 'preset', 'cwd',
  'requireMention', 'requireMentionInPost',
  'textChunkLimit', 'streaming',
  'sessionIdleTimeout', 'maxQueue', 'processingTimeoutMs', 'askTimeoutMs', 'historyLimit', 'historyMode',
  'showToolResults', 'debug',
  'access.c2cMode', 'access.groupMode', 'access.postMode',
  'access.c2cAllow', 'access.c2cBlock',
  'access.groupAllow', 'access.groupBlock',
  'access.postAllow', 'access.postBlock',
  'mentionPolicy',
  'smartJudge.prompt', 'smartJudge.maxHistory',
  'smartJudge.cooldownMs', 'smartJudge.timeoutMs',
  'interactive.enabled', 'agentSteps.enabled',
  'reactions.enabled', 'reactions.inGroup', 'reactions.ack', 'reactions.done', 'reactions.fail',
  'concurrency.c2c', 'concurrency.group', 'concurrency.post',
  'sendFile.restrictPaths',
  'selfUpdate.enabled', 'selfUpdate.channel',
  'vision.enabled', 'vision.baseUrl', 'vision.apiKey', 'vision.model',
  'imageGeneration.enabled', 'imageGeneration.baseUrl', 'imageGeneration.apiKey',
  'imageGeneration.model', 'imageGeneration.size',
] as const;

type EditableConfigKey = (typeof EDITABLE_CONFIG_KEYS)[number];

/** 白名单键的子 Schema（服务端校验：客户端校验仅为体验，安全边界在宿主） */
const EDITABLE_CONFIG_SCHEMAS: Record<EditableConfigKey, (value: unknown) => unknown> = {
  provider: stringSchema('provider'),
  model: stringSchema('model'),
  preset: stringSchema('preset'),
  cwd: cwdSchema,
  requireMention: (v) => booleanSchema(v, 'requireMention'),
  requireMentionInPost: (v) => booleanSchema(v, 'requireMentionInPost'),
  textChunkLimit: numberSchema('textChunkLimit', 1, 100000),
  streaming: (v) => booleanSchema(v, 'streaming'),
  sessionIdleTimeout: numberSchema('sessionIdleTimeout', 1000, 24 * 60 * 60 * 1000),
  maxQueue: numberSchema('maxQueue', 1, 1000),
  processingTimeoutMs: numberSchema('processingTimeoutMs', 1000, 24 * 60 * 60 * 1000),
  askTimeoutMs: numberSchema('askTimeoutMs', 1000, 24 * 60 * 60 * 1000),
  historyLimit: numberSchema('historyLimit', 0, 1000),
  historyMode: (v) => {
    if (v === 'window' || v === 'delta') return v;
    throw new Error('historyMode 只能是 window 或 delta');
  },
  showToolResults: (v) => booleanSchema(v, 'showToolResults'),
  debug: (v) => booleanSchema(v, 'debug'),
  'access.c2cMode': accessModeSchema('access.c2cMode'),
  'access.groupMode': accessModeSchema('access.groupMode'),
  'access.postMode': accessModeSchema('access.postMode'),
  'access.c2cAllow': (v) => stringListSchema(v, 'access.c2cAllow'),
  'access.c2cBlock': (v) => stringListSchema(v, 'access.c2cBlock'),
  'access.groupAllow': (v) => stringListSchema(v, 'access.groupAllow'),
  'access.groupBlock': (v) => stringListSchema(v, 'access.groupBlock'),
  'access.postAllow': (v) => stringListSchema(v, 'access.postAllow'),
  'access.postBlock': (v) => stringListSchema(v, 'access.postBlock'),
  mentionPolicy: (v) => mentionPolicySchema(v),
  'smartJudge.prompt': (v) => promptSchema(v, 'smartJudge.prompt'),
  'smartJudge.maxHistory': numberSchema('smartJudge.maxHistory', 0, 50),
  'smartJudge.cooldownMs': numberSchema('smartJudge.cooldownMs', 0, 60 * 60 * 1000),
  'smartJudge.timeoutMs': numberSchema('smartJudge.timeoutMs', 1000, 120000),
  'concurrency.c2c': (v) => strategySchema(v, 'concurrency.c2c'),
  'concurrency.group': (v) => strategySchema(v, 'concurrency.group'),
  'concurrency.post': (v) => strategySchema(v, 'concurrency.post'),
  'reactions.enabled': (v) => booleanSchema(v, 'reactions.enabled'),
  'reactions.inGroup': (v) => booleanSchema(v, 'reactions.inGroup'),
  'reactions.ack': (v) => emojiSchema(v, 'reactions.ack'),
  'reactions.done': (v) => emojiSchema(v, 'reactions.done'),
  'reactions.fail': (v) => emojiSchema(v, 'reactions.fail'),
  'interactive.enabled': (v) => booleanSchema(v, 'interactive.enabled'),
  'agentSteps.enabled': (v) => booleanSchema(v, 'agentSteps.enabled'),
  'sendFile.restrictPaths': (v) => booleanSchema(v, 'sendFile.restrictPaths'),
  'selfUpdate.enabled': (v) => booleanSchema(v, 'selfUpdate.enabled'),
  'selfUpdate.channel': (v) => {
    if (v === 'release' || v === 'main') return v;
    throw new Error('selfUpdate.channel 只能是 release 或 main');
  },
  'vision.enabled': (v) => booleanSchema(v, 'vision.enabled'),
  'vision.baseUrl': (v) => urlSchema(v, 'vision.baseUrl'),
  'vision.apiKey': (v) => secretSchema(v, 'vision.apiKey'),
  'vision.model': (v) => stringSchema('vision.model')(v),
  'imageGeneration.enabled': (v) => booleanSchema(v, 'imageGeneration.enabled'),
  'imageGeneration.baseUrl': (v) => urlSchema(v, 'imageGeneration.baseUrl'),
  'imageGeneration.apiKey': (v) => secretSchema(v, 'imageGeneration.apiKey'),
  'imageGeneration.model': (v) => stringSchema('imageGeneration.model')(v),
  'imageGeneration.size': (v) => stringSchema('imageGeneration.size')(v),
};

/** 密钥字段：只写不读；留空表示"不改动已保存的密钥" */
const SECRET_KEYS: ReadonlySet<string> = new Set(['vision.apiKey', 'imageGeneration.apiKey']);

/**
 * 端点地址校验：空串 = 清空；否则必须是 http(s) 且不带路径以外的怪东西。
 * 不允许末尾多余斜杠带来的重复拼接，统一由客户端层 normalize。
 */
function urlSchema(value: unknown, name: string): unknown {
  if (typeof value !== 'string') throw new Error(`${name} 必须是字符串`);
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (trimmed.length > 512) throw new Error(`${name} 过长`);
  if (!/^https?:\/\//i.test(trimmed)) throw new Error(`${name} 必须是 http(s) 地址`);
  return trimmed;
}

/** 密钥校验：只校验长度与字符，不打印、不回显 */
function secretSchema(value: unknown, name: string): unknown {
  if (typeof value !== 'string') throw new Error(`${name} 必须是字符串`);
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (trimmed.length > 512) throw new Error(`${name} 过长`);
  if (/\s/.test(trimmed)) throw new Error(`${name} 不能包含空白字符`);
  return trimmed;
}

/**
 * Agent 工作目录校验：必须是绝对路径。
 *
 * 所有会话共用这一个目录；相对路径会随宿主进程 cwd
 * 漂移，因此直接拒绝。空串/纯空白视为「沿用默认」，由 config 层回落。
 */
function cwdSchema(value: unknown): unknown {
  if (typeof value !== 'string') throw new Error('cwd 必须是字符串');
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (trimmed.length > 1024) throw new Error('cwd 过长');
  if (trimmed.includes('\0')) throw new Error('cwd 含非法字符');
  if (!trimmed.startsWith('/')) throw new Error('cwd 必须是绝对路径');
  return trimmed;
}

/** manual / verify 请求体大小上限（appId + appSecret 远小于此值） */
const MAX_MANUAL_BODY_BYTES = 4096;

/**
 * config 请求体大小上限：对齐 Schema 的业务边界——白名单字符串字段单个
 * 允许 20000 字符（全中文 UTF-8 约 60KB）。上限只是反滥用闸门，语义校验在 Schema。
 */
const MAX_CONFIG_BODY_BYTES = 512 * 1024;

/** 读取嵌套配置值（按点号路径；任一层不是对象则视为未设置） */
function readPath(source: unknown, dottedKey: string): unknown {
  let node: unknown = source;
  for (const segment of dottedKey.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/**
 * 工作区下拉候选目录。
 *
 * 用户不该手打绝对路径：列出现有目录（默认工作区 + ~/workspace 下的项目，
 * 其中就包含其它插件的仓库）让他直接选。当前生效值即使不在磁盘上也保留，
 * 否则下拉框会把配置回显成空。
 */
function collectWorkspaceOptions(currentCwd: string): string[] {
  const options: string[] = [];
  const add = (dir: string): void => {
    if (dir !== '' && !options.includes(dir)) options.push(dir);
  };
  add(currentCwd);
  const workspaceRoot = join(homedir(), 'workspace');
  try {
    for (const entry of readdirSync(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      add(join(workspaceRoot, entry.name));
    }
  } catch {
    // 没有 ~/workspace 就只给默认目录
  }
  add(join(homedir(), '.dsh-tuitui', 'workspace'));
  return options.slice(0, 50);
}

/** 把当前生效配置投影成端内表单可直接回显的扁平快照 */
function projectConfig(current: ImTuituiConfig): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const key of EDITABLE_CONFIG_KEYS) {
    const value = readPath(current, key);
    if (value !== undefined) snapshot[key] = value;
  }
  if (typeof current.cwd === 'string') snapshot.cwd = current.cwd;
  // 密钥永远不出现在快照里：只回一个"是否已设置"的布尔，
  // 前端据此显示"已设置（留空则不修改）"。
  for (const key of SECRET_KEYS) {
    const value = snapshot[key];
    delete snapshot[key];
    snapshot[`${key}Set`] = typeof value === 'string' && value !== '';
  }
  return snapshot;
}

/**
 * 注册绑定路由（状态查询 / 校验 / 手动凭据 / 解绑 / 配置读写）。
 *
 * @param webServer - ctx.webServer
 * @param service - 绑定状态机；已绑定 fiber 传 null（无待绑定流程）
 * @param logger - 日志
 * @param options - 行为注入（bound 态回显、manual/verify 处理）
 * @returns 注销函数（与插件 fiber 生命周期绑定）
 */
export function registerBindRoutes(
  webServer: WebServerLike,
  service: BindingService | null,
  logger: Logger,
  options: BindRoutesOptions = {},
): () => void {
  const handleVerify = options.onVerify ?? ((credentials: SetupCredentials) => {
    const current = options.currentConfig?.();
    // 未注入配置时（单测/极简宿主）用凭据本身构造端点中立的临时配置：
    // 校验只需要 appId/appSecret 与默认生产端点
    const config = current ?? ({ ...credentials, debug: false } as unknown as ImTuituiConfig);
    return verifyTuituiCredentials(credentials, config, logger);
  });

  const defaultManual = async (credentials: SetupCredentials): Promise<ManualSubmitResult> => {
    const outcome = await handleVerify(credentials);
    if (!outcome.ok) return { persisted: false, error: outcome.error };
    const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, logger);
    return persisted
      ? { persisted: true }
      : { persisted: false, error: '无法定位 profile 目录或写入失败，请改用环境变量配置' };
  };
  const handleManualSubmit = options.onManualCredentials ?? defaultManual;

  const disposers = [
    webServer.register({
      kind: 'exact',
      path: BIND_STATE_PATH,
      handler: (req, res) => { handleState(req, res, service, options); },
    }),
    webServer.register({
      kind: 'exact',
      path: BIND_VERIFY_PATH,
      handler: (req, res) => handleVerifyRequest(req, res, handleVerify),
    }),
    webServer.register({
      kind: 'exact',
      path: BIND_MANUAL_PATH,
      handler: (req, res) => handleManual(req, res, handleManualSubmit),
    }),
    webServer.register({
      kind: 'exact',
      path: BIND_UNBIND_PATH,
      handler: (req, res) => handleUnbind(req, res, options),
    }),
    webServer.register({
      kind: 'exact',
      path: BIND_CONFIG_PATH,
      handler: (req, res) => handleConfig(req, res, options),
    }),
    webServer.register({
      kind: 'exact',
      path: TEST_MODEL_PATH,
      handler: (req, res) => handleTestModel(req, res, options),
    }),
  ];
  logger.info(`im-tuitui: 端内绑定页已就绪: ${BIND_STATE_PATH}`);
  return () => { for (const dispose of disposers) dispose(); };
}

/**
 * 请求来源校验（最小 CSRF 防护）。
 *
 * 带 Origin 的请求必须与 Host 同源；同源 fetch 与 Desktop IPC 桥
 * （后者会删除 origin 头）均放行。本路由数据不敏感且动作无害，
 * 该级别的防护足够。
 */
function trusted(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function handleState(
  req: IncomingMessage,
  res: ServerResponse,
  service: BindingService | null,
  options: BindRoutesOptions,
): void {
  if (!trusted(req)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  // 已绑定优先（appSecret 不回传，appId 非机密可回显）
  const bound = options.boundState?.() ?? null;
  if (bound !== null) {
    sendJson(res, 200, bound);
    return;
  }
  // 无绑定服务（已绑定 fiber 未注入 boundState 的异常态）按未配置处理，
  // 端内页面据此展示手填表单，而不是卡在「加载中」
  sendJson(res, 200, service?.wireState() ?? { phase: 'unconfigured' });
}

/** 读取并解析 JSON 请求体（带大小上限） */
async function readJsonBody(req: IncomingMessage, maxBytes: number = MAX_MANUAL_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) throw new Error('request body too large');
    chunks.push(buffer);
  }
  if (size === 0) throw new Error('empty request body');
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * 提示词校验：允许换行与中文标点，拒绝控制字符，限制长度避免把配置撑爆。
 *
 * 空串是合法值——表示「用内置默认提示词」，用户清空输入框即可恢复出厂。
 */
function promptSchema(value: unknown, name: string): unknown {
  if (typeof value !== 'string') throw new TypeError(`${name} 必须是字符串`);
  if (value.length > 8000) throw new TypeError(`${name} 过长（最多 8000 字符）`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new TypeError(`${name} 含非法控制字符`);
  }
  return value;
}

/** 校验手动提交的凭据形态（不打印内容） */
function parseCredentials(body: unknown): SetupCredentials | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const appId = typeof record.appId === 'string' ? record.appId.trim() : '';
  const appSecret = typeof record.appSecret === 'string' ? record.appSecret.trim() : '';
  if (appId.length === 0 || appSecret.length === 0) return null;
  if (appId.length > 128 || appSecret.length > 256) return null;
  return { appId, appSecret };
}

/** 仅校验：成功回显机器人信息（不落盘，不改变绑定相位以外的任何状态） */
async function handleVerifyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  verify: (credentials: SetupCredentials) => Promise<VerifyOutcome>,
): Promise<void> {
  if (!trusted(req)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: `invalid request body: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  const credentials = parseCredentials(body);
  if (credentials === null) {
    sendJson(res, 400, { ok: false, error: 'appId 与 appSecret 不能为空' });
    return;
  }
  const outcome = await verify(credentials);
  if (!outcome.ok) {
    sendJson(res, 400, { ok: false, error: outcome.error });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    message: `校验通过：${outcome.bot.name}（账号 ${outcome.bot.account}）`,
    bot: outcome.bot,
  });
}

async function handleManual(
  req: IncomingMessage,
  res: ServerResponse,
  submit: (credentials: SetupCredentials) => Promise<ManualSubmitResult>,
): Promise<void> {
  if (!trusted(req)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: `invalid request body: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  const credentials = parseCredentials(body);
  if (credentials === null) {
    sendJson(res, 400, { ok: false, error: 'appId 与 appSecret 不能为空' });
    return;
  }
  const result = await submit(credentials);
  if (!result.persisted) {
    sendJson(res, 500, { ok: false, error: result.error ?? '保存失败' });
    return;
  }
  // 写入 profile patch 触发 HMR 重载，新 fiber 以新凭据启动网关
  sendJson(res, 200, { ok: true, message: result.message ?? '凭据已保存，插件将自动重载' });
}

/**
 * 解绑：仅已绑定态可执行；移除 profile patch 中的凭据并触发 HMR 重载。
 *
 * 环境变量提供的凭据不可端内解绑：写入 profile 也删不掉部署环境的 export，
 * 重载后 resolveEnv 仍会读回，状态会停在 bound——这是明确告知用户而非
 * 假成功后静默失败。
 */
function handleUnbind(req: IncomingMessage, res: ServerResponse, options: BindRoutesOptions): void {
  if (!trusted(req)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  req.resume();
  const bound = options.boundState?.() ?? null;
  if (bound === null) {
    sendJson(res, 409, { ok: false, error: '当前未绑定' });
    return;
  }
  if (bound.fromEnv === true) {
    sendJson(res, 409, {
      ok: false,
      error: '凭据来自环境变量（TUITUI_BOT_APPID / TUITUI_BOT_SECRET），请在部署环境修改后重启',
    });
    return;
  }
  const result: UnbindResult = options.onUnbind === undefined
    ? (() => {
        const removed = removeCredentialsFromProfile(getProfileDir() ?? undefined, undefined);
        if (removed) {
          // 清除进程内凭据：手动绑定成功时可能写入 env（供热更新后的下次
          // apply 兜底读取）；不清则 HMR 重载后新 fiber 仍从 env 读到
          // 凭据，解绑不生效（状态一直停留在 bound）
          delete process.env.TUITUI_BOT_APPID;
          delete process.env.TUITUI_BOT_SECRET;
        }
        return removed
          ? { persisted: true }
          : { persisted: false, error: '无法定位 profile 目录或写入失败，请手动编辑 cordis.patch.yml' };
      })()
    : options.onUnbind();
  if (!result.persisted) {
    sendJson(res, 500, { ok: false, error: result.error ?? '解绑失败' });
    return;
  }
  // 移除后写入触发 HMR 重载，插件回到未绑定态（绑定流程重新可用）
  sendJson(res, 200, { ok: true, message: '已解绑，插件将重载并重新进入绑定流程' });
}

/**
 * 配置读写：
 * - GET：回显当前生效配置（扁平 dotted key 快照，appSecret 永不返回）
 * - POST：白名单 + 逐键 Schema 校验 → 最小写入 profile patch → HMR 重载
 */
async function handleConfig(req: IncomingMessage, res: ServerResponse, options: BindRoutesOptions): Promise<void> {
  if (!trusted(req)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  if (req.method === 'GET') {
    const current = options.currentConfig;
    if (current === undefined) {
      // 无配置注入（极简宿主/单测）时给空快照：端内表单退化为「只读空态」
      sendJson(res, 200, { config: {} });
      return;
    }
    const config = current();
    sendJson(res, 200, {
      config: {
        ...projectConfig(config),
        // 只读候选，写回时会被服务端白名单忽略
        workspaceOptions: collectWorkspaceOptions(typeof config.cwd === 'string' ? config.cwd : ''),
      },
    });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_CONFIG_BODY_BYTES);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: `invalid request body: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  if (typeof body !== 'object' || body === null) {
    sendJson(res, 400, { ok: false, error: '请求体必须是 JSON 对象' });
    return;
  }
  const submitted = body as Record<string, unknown>;

  // 白名单与凭据字段拦截
  for (const key of Object.keys(submitted)) {
    if (!isEditableKey(key)) {
      const reason = key === 'appId' || key === 'appSecret'
        ? '凭据请使用绑定/更换/解绑功能'
        : '不支持的字段';
      sendJson(res, 400, { ok: false, error: `${reason}: ${key}` });
      return;
    }
  }

  // 逐键 Schema 校验（非法值拒绝，返回首个错误）
  const validated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(submitted)) {
    // 密钥字段留空 = 不动已保存的值（前端永远拿不到明文，只能"要不要改"）
    if (SECRET_KEYS.has(key) && (value === '' || value === null || value === undefined)) continue;
    const check = isEditableKey(key) ? EDITABLE_CONFIG_SCHEMAS[key] : undefined;
    if (check === undefined) {
      sendJson(res, 400, { ok: false, error: `不支持的字段: ${key}` });
      return;
    }
    try {
      validated[key] = check(value);
    } catch (err) {
      // 校验器的报错要原样回给设置页：只认 TypeError 会让 cwdSchema 这类普通
      // Error 变成 "Error: cwd 必须是绝对路径"，用户看到脏前缀
      sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
  }

  const persisted = options.onUpdateConfig === undefined
    ? updateProfileConfig(validated, getProfileDir() ?? undefined, undefined)
    : options.onUpdateConfig(validated);
  if (!persisted) {
    sendJson(res, 500, { ok: false, error: '无法定位 profile 目录或写入失败' });
    return;
  }
  sendJson(res, 200, { ok: true, message: '配置已保存，插件将自动重载（进行中的机器人会话将重置）' });
}

/**
 * 图像端点连接测试。
 *
 * 设计要点（对齐主流做法）：
 * - 请求里可以带 baseUrl/model/apiKey 覆盖；**没带就用已保存的**，
 *   所以界面上密钥框永远是空的也能测。
 * - 只做一次 `/models` 探测，不生成任何东西、不花钱。
 * - 响应里绝不含密钥，只回一句话结论。
 */
async function handleTestModel(
  req: IncomingMessage,
  res: ServerResponse,
  options: BindRoutesOptions,
): Promise<void> {
  if (!trusted(req)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_MANUAL_BODY_BYTES);
  } catch (err) {
    sendJson(res, 400, { ok: false, detail: `请求体非法: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  if (typeof body !== 'object' || body === null) {
    sendJson(res, 400, { ok: false, detail: '请求体必须是 JSON 对象' });
    return;
  }

  const input = body as Record<string, unknown>;
  const kind = input.kind;
  if (kind !== 'vision' && kind !== 'image') {
    sendJson(res, 400, { ok: false, detail: 'kind 只能是 vision 或 image' });
    return;
  }

  const current = options.currentConfig?.();
  const stored = kind === 'vision' ? current?.vision : current?.imageGeneration;
  const pick = (value: unknown, fallback: string | undefined): string =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : (fallback ?? '');

  const config = {
    enabled: true,
    baseUrl: pick(input.baseUrl, stored?.baseUrl),
    model: pick(input.model, stored?.model),
    apiKey: pick(input.apiKey, stored?.apiKey),
    timeoutMs: 20000,
  };

  const result = await probeEndpoint(config, kind);
  const response: TestModelResponse = result;
  sendJson(res, 200, response);
}

/** 键是否在白名单内（类型守卫：让编辑表按 EditableConfigKey 索引） */
function isEditableKey(key: string): key is EditableConfigKey {
  return (EDITABLE_CONFIG_KEYS as readonly string[]).includes(key);
}

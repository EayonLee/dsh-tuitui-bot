/**
 * 端内绑定协议 —— 宿主路由与客户端面板的共享契约
 *
 * 类型与路径常量的唯一事实源：宿主（setup/bind-routes.ts）与浏览器
 * （client/bind-page.ts）各自 import，杜绝两端协议漂移。
 * 本模块必须保持纯类型 + 纯常量（零 node 依赖、零副作用）：
 * 客户端 tsdown 构建会将其内联进 bundle。
 *
 * 推推无扫码绑定，凭据由用户在推推机器人后台创建后手填，
 * 因此状态机只有「未配置 / 校验中 / 校验失败 / 已绑定」四态。
 */

/** 状态查询（绑定页轮询 + 设置页回显） */
export const BIND_STATE_PATH = '/tuitui/im-tuitui/bind';

/** 手动填写/编辑凭据（绑定页表单） */
export const BIND_MANUAL_PATH = '/tuitui/im-tuitui/bind/manual';

/** 凭据在线校验（调用 property.info） */
export const BIND_VERIFY_PATH = '/tuitui/im-tuitui/bind/verify';

/** 解绑：移除已保存凭据，回到未配置状态 */
export const BIND_UNBIND_PATH = '/tuitui/im-tuitui/bind/unbind';

/** 配置读写（设置面板表单） */
export const BIND_CONFIG_PATH = '/tuitui/im-tuitui/config';

/** 图像理解 / 生成端点的连接测试（不回显密钥） */
export const TEST_MODEL_PATH = '/tuitui/im-tuitui/test-model';

/** 连接测试请求体：留空的字段表示"用已保存的值" */
export interface TestModelRequest {
  kind: 'vision' | 'image';
  baseUrl?: string;
  model?: string;
  /** 只写不读：传空串表示用已保存的密钥 */
  apiKey?: string;
}

/** 连接测试响应 */
export interface TestModelResponse {
  ok: boolean;
  detail: string;
  modelFound?: boolean;
}

/** 线上协议（HTTP 路由序列化形态） */
export type BindStateWire =
  | { phase: 'unconfigured' }
  | { phase: 'validating' }
  | { phase: 'failed'; reason: string }
  | {
      phase: 'bound';
      appId: string;
      /** 机器人名称（property.info 回显） */
      botName?: string;
      /** 机器人域账号 */
      botAccount?: string;
      /** 是否来自环境变量（此时端内不可解绑） */
      fromEnv?: boolean;
    };

/** 机器人信息（校验成功后的回显） */
export interface BotInfoWire {
  name: string;
  uid: string;
  account: string;
}

/** manual / verify / unbind 操作的统一响应 */
export interface BindActionResponse {
  ok: boolean;
  message?: string;
  error?: string;
  state?: BindStateWire;
}

/** 设置面板可编辑字段（与服务端 config.ts 对应项保持一致） */
export interface ConfigPatchWire {
  provider?: string;
  model?: string;
  preset?: string;
  cwd?: string;
  requireMention?: boolean;
  requireMentionInPost?: boolean;
  textChunkLimit?: number;
  streaming?: boolean;
  sessionIdleTimeout?: number;
  maxQueue?: number;
  processingTimeoutMs?: number;
  askTimeoutMs?: number;
  historyLimit?: number;
  historyMode?: 'window' | 'delta';
  showToolResults?: boolean;
  debug?: boolean;
  'access.c2cMode'?: 'open' | 'allowlist' | 'blocklist' | 'disabled';
  'access.groupMode'?: 'open' | 'allowlist' | 'blocklist' | 'disabled';
  'access.postMode'?: 'open' | 'allowlist' | 'blocklist' | 'disabled';
  'access.c2cAllow'?: string[];
  'access.c2cBlock'?: string[];
  'access.groupAllow'?: string[];
  'access.groupBlock'?: string[];
  'access.postAllow'?: string[];
  'access.postBlock'?: string[];
  mentionPolicy?: 'require' | 'always' | 'smart';
  'concurrency.c2c'?: 'queue' | 'drop' | 'abort' | 'merge';
  'concurrency.group'?: 'queue' | 'drop' | 'abort' | 'merge';
  'concurrency.post'?: 'queue' | 'drop' | 'abort' | 'merge';
  'interactive.enabled'?: boolean;
  'agentSteps.enabled'?: boolean;
  'reactions.enabled'?: boolean;
  'reactions.inGroup'?: boolean;
  'reactions.ack'?: string;
  'reactions.done'?: string;
  'reactions.fail'?: string;
  'sendFile.restrictPaths'?: boolean;
  'smartJudge.prompt'?: string;
  'smartJudge.maxHistory'?: number;
  'smartJudge.cooldownMs'?: number;
  'smartJudge.timeoutMs'?: number;
  groupPrompt?: string;
  directPrompt?: string;
  postPrompt?: string;
  'vision.enabled'?: boolean;
  'vision.baseUrl'?: string;
  'vision.model'?: string;
  /** 只写：留空表示不改动已保存的密钥 */
  'vision.apiKey'?: string;
  /** 只读回显：是否已经存过密钥 */
  'vision.apiKeySet'?: boolean;
  'imageGeneration.enabled'?: boolean;
  'imageGeneration.baseUrl'?: string;
  'imageGeneration.model'?: string;
  'imageGeneration.size'?: string;
  'imageGeneration.apiKey'?: string;
  'imageGeneration.apiKeySet'?: boolean;
}

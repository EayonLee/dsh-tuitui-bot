/**
 * dsh-tuitui-bot 插件配置 Schema
 *
 * 语义与上游 dsh-qqbot 一一对应；新增推推专有项（post 作用域、交互卡片、
 * agent 步骤上报、服务端地址覆盖）。
 */
import Schema from '@deepseek-ai/schemastery';

export interface AccessControlConfig {
  /** 单聊访问模式 */
  c2cMode: 'open' | 'allowlist' | 'disabled';
  /** 单聊白名单（域账号或 uid） */
  c2cAllow: string[];
  /** 群聊访问模式 */
  groupMode: 'open' | 'allowlist' | 'disabled';
  /** 群聊白名单（group_id） */
  groupAllow: string[];
  /** 团队帖子访问模式 */
  postMode: 'open' | 'allowlist' | 'disabled';
  /** 团队帖子白名单（channel_id 或 team_id） */
  postAllow: string[];
}

export interface MediaConfig {
  /** 是否启用富媒体理解（图片/文件下载 + 工具分析） */
  enabled: boolean;
  /** 富媒体下载大小上限（MB），默认 200 */
  maxMB: number;
  /** 富媒体存活时长（小时，TTL），默认 24，0 = 永不过期 */
  ttlHours: number;
}

export interface VisionConfig {
  enabled: boolean;
  provider: string;
  model: string;
  defaultPrompt: string;
  maxBytes: number;
  maxTokens: number;
  timeoutMs: number;
}

/** 附件发送配置（tuitui_send_file 工具与 present 交付物投递共用） */
export interface SendFileConfig {
  restrictPaths: boolean;
  extraRoots: string[];
  sendPresentedFiles: boolean;
  maxFiles: number;
}

/** 交互卡片配置（approval / question 通道） */
export interface InteractiveConfig {
  /** 是否使用推推原生交互卡片（关闭则退化为纯文本指令应答） */
  enabled: boolean;
  /** 卡片头部背景色 */
  headBgColor: string;
  /** 卡片头部文字颜色 */
  headTextColor: string;
}

/** Agent 执行步骤上报配置（client.agent → 推推客户端原生展示） */
export interface AgentStepsConfig {
  /** 是否上报模型调用与工具调用中间步骤 */
  enabled: boolean;
  /** 是否上报完整 tool 参数/结果（关闭则只报名称与状态） */
  includeToolPayload: boolean;
  /** 工具结果截断字符数 */
  maxResultChars: number;
}

export interface ImTuituiConfig {
  /** 推推机器人 AppID */
  appId: string;
  /** 推推机器人 AppSecret */
  appSecret: string;
  /** dsh LLM 提供商名称 */
  provider?: string;
  /** 模型名称 */
  model?: string;
  /** Agent preset id */
  preset?: string;
  /** Agent 工作目录（缺省 ~/.dsh-tuitui/workspace，不随宿主进程 cwd） */
  cwd?: string;
  /** 群聊是否需要 @bot 触发 */
  requireMention: boolean;
  /** 团队帖子是否需要 @bot 触发 */
  requireMentionInPost: boolean;
  /** 群聊额外 system prompt */
  groupPrompt?: string;
  /** 私聊额外 system prompt */
  directPrompt?: string;
  /** 团队帖子额外 system prompt */
  postPrompt?: string;
  /** 单条消息最大长度（推推文本消息上限内保守取值） */
  textChunkLimit: number;
  /** 是否启用流式输出（原地编辑；群聊/帖子始终不启用） */
  streaming: boolean;
  /** 流式刷新节流(ms) */
  streamIntervalMs: number;
  /** 每会话最大闲置时长(ms)，超时自动回收 */
  sessionIdleTimeout: number;
  /** 并发队列最大长度 */
  maxQueue: number;
  /** 处理超时(ms)，超时中断当前 LLM 调用 */
  processingTimeoutMs: number;
  /** 待答问题超时(ms)，超时自动拒绝并提示（ask_user_question） */
  askTimeoutMs: number;
  /** 群历史缓冲条数 */
  historyLimit: number;
  /** 访问控制 */
  access: AccessControlConfig;
  /** 是否展示工具调用成功结果（工具错误始终展示） */
  showToolResults: boolean;
  /** 调试模式 */
  debug: boolean;
  /** 富媒体理解 */
  media: MediaConfig;
  /** 视觉理解（tuitui_describe_image 工具） */
  vision: VisionConfig;
  /** 附件发送 */
  sendFile: SendFileConfig;
  /** 交互卡片 */
  interactive: InteractiveConfig;
  /** Agent 步骤上报 */
  agentSteps: AgentStepsConfig;
  /** 推推 OpenAPI 地址覆盖（私有化部署） */
  apiBaseUrl?: string;
  /** 推推 WebSocket 地址覆盖 */
  websocketBaseUrl?: string;
}

export const AccessControlSchema: Schema<AccessControlConfig> = Schema.object({
  c2cMode: Schema.union(['open', 'allowlist', 'disabled']).default('open').description('单聊访问模式（默认开放）'),
  c2cAllow: Schema.array(Schema.string()).default([]).description('单聊白名单（域账号或 UID）'),
  groupMode: Schema.union(['open', 'allowlist', 'disabled']).default('open').description('群聊访问模式（默认开放：群自带进群门槛 + @bot 触发）'),
  groupAllow: Schema.array(Schema.string()).default([]).description('群聊白名单（group_id）'),
  postMode: Schema.union(['open', 'allowlist', 'disabled']).default('open').description('团队帖子访问模式（默认开放）'),
  postAllow: Schema.array(Schema.string()).default([]).description('团队帖子白名单（channel_id 或 team_id）'),
});

export const ConfigSchema: Schema<ImTuituiConfig> = Schema.object({
  appId: Schema.string().default('').description('推推机器人 AppID'),
  appSecret: Schema.string().default('').description('推推机器人 AppSecret'),
  provider: Schema.string().description('LLM provider name'),
  model: Schema.string().description('Model name'),
  preset: Schema.string().description('Agent preset id'),
  cwd: Schema.string().description('Agent working directory (default ~/.dsh-tuitui/workspace)'),
  requireMention: Schema.boolean().default(true).description('群聊是否需要@bot触发'),
  requireMentionInPost: Schema.boolean().default(true).description('团队帖子是否需要@bot触发'),
  groupPrompt: Schema.string().description('群聊额外system prompt'),
  directPrompt: Schema.string().description('私聊额外system prompt'),
  postPrompt: Schema.string().description('团队帖子额外system prompt'),
  textChunkLimit: Schema.number().default(4000).description('单条消息最大字符数'),
  streaming: Schema.boolean().default(true).description('是否启用流式输出（原地编辑；群聊/帖子始终不启用）'),
  streamIntervalMs: Schema.number().default(600).description('流式刷新节流(ms)'),
  sessionIdleTimeout: Schema.number().default(30 * 60 * 1000).description('会话闲置超时(ms)'),
  maxQueue: Schema.number().default(20).description('并发队列最大长度'),
  processingTimeoutMs: Schema.number().default(30 * 60 * 1000).description('处理超时(ms)，超时中断当前 LLM 调用'),
  askTimeoutMs: Schema.number().default(5 * 60 * 1000).description('待答问题超时(ms)，超时自动拒绝并提示'),
  historyLimit: Schema.number().default(10).description('群历史缓冲条数'),
  access: AccessControlSchema.default({
    c2cMode: 'open',
    c2cAllow: [],
    groupMode: 'open',
    groupAllow: [],
    postMode: 'open',
    postAllow: [],
  }).description('访问控制'),
  showToolResults: Schema.boolean().default(false).description('是否展示工具调用成功结果（错误始终展示）'),
  debug: Schema.boolean().default(false),
  media: Schema.object({
    enabled: Schema.boolean().default(true).description('是否启用富媒体理解（图片/文件下载 + 工具分析）'),
    maxMB: Schema.number().default(200).description('富媒体下载大小上限(MB)'),
    ttlHours: Schema.number().default(24).description('富媒体存活时长(小时)，0=永不过期'),
  }).default({ enabled: true, maxMB: 200, ttlHours: 24 }).description('富媒体理解配置'),
  vision: Schema.object({
    enabled: Schema.boolean().default(false).description('是否启用视觉理解（tuitui_describe_image 工具）'),
    provider: Schema.string().default('').description('视觉模型 provider（dsh 注册的 llm adapter，如 pi-ai）'),
    model: Schema.string().default('').description('视觉模型 id（如 qwen-vl-max）'),
    defaultPrompt: Schema.string().default('Describe this image in detail.').description('默认描述 prompt'),
    maxBytes: Schema.number().default(10 * 1024 * 1024).description('图片字节上限'),
    maxTokens: Schema.number().default(1024).description('输出 token 上限'),
    timeoutMs: Schema.number().default(120000).description('视觉调用超时(ms)'),
  }).default({
    enabled: false,
    provider: '',
    model: '',
    defaultPrompt: 'Describe this image in detail.',
    maxBytes: 10 * 1024 * 1024,
    maxTokens: 1024,
    timeoutMs: 120000,
  }).description('视觉理解配置'),
  sendFile: Schema.object({
    restrictPaths: Schema.boolean().default(true).description('是否启用路径白名单（默认 true，仅允许 media + cwd + extraRoots）'),
    extraRoots: Schema.array(Schema.string()).default([]).description('额外允许访问的根目录'),
    sendPresentedFiles: Schema.boolean().default(true).description('是否将 present 声明的交付文件发送到当前会话'),
    maxFiles: Schema.number().default(4).description('单轮最多投递的交付文件数'),
  }).default({ restrictPaths: true, extraRoots: [], sendPresentedFiles: true, maxFiles: 4 }).description('附件发送配置'),
  interactive: Schema.object({
    enabled: Schema.boolean().default(true).description('是否使用推推原生交互卡片（问答/审批）'),
    headBgColor: Schema.string().default('#1F6FEB').description('卡片头部背景色'),
    headTextColor: Schema.string().default('#FFFFFF').description('卡片头部文字颜色'),
  }).default({ enabled: true, headBgColor: '#1F6FEB', headTextColor: '#FFFFFF' }).description('交互卡片配置'),
  agentSteps: Schema.object({
    enabled: Schema.boolean().default(true).description('是否上报模型/工具调用中间步骤（推推客户端原生展示）'),
    includeToolPayload: Schema.boolean().default(false).description('是否上报完整工具参数与结果'),
    maxResultChars: Schema.number().default(800).description('工具结果截断字符数'),
  }).default({ enabled: true, includeToolPayload: false, maxResultChars: 800 }).description('Agent 步骤上报配置'),
  apiBaseUrl: Schema.string().description('推推 OpenAPI 地址（私有化部署覆盖）'),
  websocketBaseUrl: Schema.string().description('推推 WebSocket 地址（私有化部署覆盖）'),
});

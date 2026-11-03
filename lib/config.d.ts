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
export declare const AccessControlSchema: Schema<AccessControlConfig>;
export declare const ConfigSchema: Schema<ImTuituiConfig>;
//# sourceMappingURL=config.d.ts.map
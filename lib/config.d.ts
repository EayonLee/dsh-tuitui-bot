/**
 * dsh-tuitui-bot 插件配置 Schema
 *
 * 覆盖三类能力：会话与触发策略、推推专有交互（团队帖子 / 交互卡片 /
 * agent 步骤上报）、以及指向推推服务端的地址覆盖。
 */
import Schema from '@deepseek-ai/schemastery';
/** 单个作用域的访问模式：开放 / 仅白名单 / 仅排除黑名单 / 全拒 */
export type AccessMode = 'open' | 'allowlist' | 'blocklist' | 'disabled';
export interface AccessControlConfig {
    /** 单聊访问模式 */
    c2cMode: AccessMode;
    /** 单聊白名单（域账号或 uid） */
    c2cAllow: string[];
    /** 单聊黑名单（域账号或 uid，优先级高于任何模式） */
    c2cBlock: string[];
    /** 群聊访问模式 */
    groupMode: AccessMode;
    /** 群聊白名单（group_id） */
    groupAllow: string[];
    /** 群聊黑名单（group_id） */
    groupBlock: string[];
    /** 团队帖子访问模式 */
    postMode: AccessMode;
    /** 团队帖子白名单（channel_id 或 team_id） */
    postAllow: string[];
    /** 团队帖子黑名单（channel_id 或 team_id） */
    postBlock: string[];
}
/**
 * 群聊/帖子的触发方式：
 *   - require：必须 @ 机器人才回应（默认）
 *   - always：每条消息都回应（适合小群/专用群）
 *   - smart：不 @ 也回应，但只回「与机器人相关」的消息——引用了机器人、
 *     文本里出现机器人别名、或刚聊过的人继续追问（窗口见 smartFollowUpMs）
 */
export type MentionPolicy = 'require' | 'always' | 'smart';
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
    /** 群聊是否需要 @bot 触发（mentionPolicy 未设置时用它推导） */
    requireMention: boolean;
    /** 团队帖子是否需要 @bot 触发 */
    requireMentionInPost: boolean;
    /** 群聊/帖子的触发方式，未设置时由上面两个布尔推导 */
    mentionPolicy?: MentionPolicy;
    /** smart 模式：文本中出现这些名字即视为在叫机器人 */
    botAliases: string[];
    /** smart 模式：机器人回复后多久内、同一个人继续发消息算「延续对话」（ms） */
    smartFollowUpMs: number;
    /** smart 模式：把上下文交给模型判断是否插嘴的参数 */
    smartJudge: {
        /** 关掉就退回确定性规则（别名 / 追问窗口） */
        enabled: boolean;
        /** 判定时携带的历史条数 */
        maxHistory: number;
        /** 判定输出上限（只要一行 JSON，不需要多） */
        maxTokens: number;
        /** 判定超时（超时视为不插嘴） */
        timeoutMs: number;
        /** 同一会话两次判定的最小间隔 */
        cooldownMs: number;
        /** 判定提示词（设置页可编辑，出厂值见 DEFAULT_SMART_PROMPT） */
        prompt: string;
    };
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
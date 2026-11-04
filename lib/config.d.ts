/**
 * dsh-tuitui-bot 插件配置 Schema
 *
 * 覆盖三类能力：会话与触发策略、推推专有交互（团队帖子 / 交互卡片 /
 * agent 步骤上报）、以及指向推推服务端的地址覆盖。
 */
import Schema from '@deepseek-ai/schemastery';
import type { ConcurrencyStrategy } from './gateway/middleware/concurrency-guard.ts';
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
 *   - smart：不 @ 也会说话——每句都交给模型，按人格与上下文自己判断要不要插嘴
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
/**
 * 一个 OpenAI 兼容的图像端点。
 *
 * 理解与生成各配一套，互不影响：地址 + 密钥 + 模型 id，就这三样。
 * apiKey 只在服务端用，永远不往回吐。
 */
export interface ImageModelConfig {
    enabled: boolean;
    /** OpenAI 兼容 base url，例如 https://llm.api.zyuncs.com/v1 */
    baseUrl: string;
    /** 密钥（只写不读：设置页永远显示空） */
    apiKey: string;
    /** 模型 id，例如 qwen/qwen3-vl-30b-a3b-instruct */
    model: string;
}
export interface VisionConfig extends ImageModelConfig {
    /** 兼容旧字段：dsh llm adapter 名（配了 baseUrl/apiKey 后不再使用） */
    provider: string;
    defaultPrompt: string;
    maxBytes: number;
    maxTokens: number;
    timeoutMs: number;
}
/** 图像生成配置 */
export interface ImageGenerationConfig extends ImageModelConfig {
    /** 出图尺寸，例如 1024x1024 */
    size: string;
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
    /**
     * 审批卡片等待上限（毫秒，0 = 不限）。
     *
     * 超时按 `cancelled` 结算并把卡片改写成「⌛ 审批超时已作废」：点击送不回插件时，
     * 依赖审批的工具调用会一直挂着，整个会话跟着卡死。
     */
    approvalTimeoutMs: number;
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
    /** smart 模式：把上下文交给模型判断是否插嘴的参数 */
    smartJudge: {
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
    /** 同一会话同时来多条消息时的处理方式（按作用域分开） */
    concurrency: {
        /** 单聊：默认打断前一条，直接接新话 */
        c2c: ConcurrencyStrategy;
        /** 群聊：默认排队，一条条来 */
        group: ConcurrencyStrategy;
        /** 团队帖子：默认排队 */
        post: ConcurrencyStrategy;
    };
    /** 表情回执：收到 / 处理完 / 出错 时挂在那条消息上的反应 */
    reactions: {
        /** 总开关 */
        enabled: boolean;
        /** 群聊里也给回执 */
        inGroup: boolean;
        /** 收到时挂的表情（空串 = 不挂） */
        ack: string;
        /** 处理完换成的表情（空串 = 只撤不换） */
        done: string;
        /** 出错换成的表情（空串 = 只撤不换） */
        fail: string;
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
    /** 图像生成配置 */
    imageGeneration: ImageGenerationConfig;
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
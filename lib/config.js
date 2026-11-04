/**
 * dsh-tuitui-bot 插件配置 Schema
 *
 * 覆盖三类能力：会话与触发策略、推推专有交互（团队帖子 / 交互卡片 /
 * agent 步骤上报）、以及指向推推服务端的地址覆盖。
 */
import Schema from '@deepseek-ai/schemastery';
import { DEFAULT_SMART_PROMPT } from "./shared/smart-prompt.js";
export const AccessControlSchema = Schema.object({
    c2cMode: Schema.union(['open', 'allowlist', 'blocklist', 'disabled']).default('open').description('单聊访问模式（默认开放）'),
    c2cAllow: Schema.array(Schema.string()).default([]).description('单聊白名单（域账号或 UID）'),
    c2cBlock: Schema.array(Schema.string()).default([]).description('单聊黑名单（优先级最高）'),
    groupMode: Schema.union(['open', 'allowlist', 'blocklist', 'disabled']).default('open').description('群聊访问模式（默认开放：群自带进群门槛 + @bot 触发）'),
    groupAllow: Schema.array(Schema.string()).default([]).description('群聊白名单（group_id）'),
    groupBlock: Schema.array(Schema.string()).default([]).description('群聊黑名单（group_id，优先级最高）'),
    postMode: Schema.union(['open', 'allowlist', 'blocklist', 'disabled']).default('disabled').description('团队帖子访问模式（默认禁用：团队频道里不工作）'),
    postAllow: Schema.array(Schema.string()).default([]).description('团队帖子白名单（channel_id 或 team_id）'),
    postBlock: Schema.array(Schema.string()).default([]).description('团队帖子黑名单（channel_id 或 team_id，优先级最高）'),
});
export const ConfigSchema = Schema.object({
    appId: Schema.string().default('').description('推推机器人 AppID'),
    appSecret: Schema.string().default('').description('推推机器人 AppSecret'),
    provider: Schema.string().description('LLM provider name'),
    model: Schema.string().description('Model name'),
    preset: Schema.string().description('Agent preset id'),
    cwd: Schema.string().description('Agent working directory (default ~/.dsh-tuitui/workspace)'),
    requireMention: Schema.boolean().default(true).description('群聊是否需要@bot触发'),
    requireMentionInPost: Schema.boolean().default(true).description('团队帖子是否需要@bot触发'),
    mentionPolicy: Schema.union(['require', 'always', 'smart']).default('smart').description('群聊/帖子触发方式：require=仅@ / always=全部 / smart=按人格与上下文自主判断（默认）'),
    smartJudge: Schema.object({
        maxHistory: Schema.number().default(50).description('判定时携带的群聊历史条数'),
        maxTokens: Schema.number().default(800).description('判定输出上限 token（思考型模型要留够，否则正文空）'),
        timeoutMs: Schema.number().default(20000).description('判定超时(ms)：思考型模型几秒才出结果，8 秒经常卡在「还在想」'),
        cooldownMs: Schema.number().default(5000).description('同一会话两次判定的最小间隔(ms)'),
        prompt: Schema.string().default(DEFAULT_SMART_PROMPT).description('智能插话判定的提示词（设置页可编辑）'),
    }).description('智能插话判定参数（smart 触发方式专用）'),
    concurrency: Schema.object({
        c2c: Schema.union(['queue', 'drop', 'abort', 'merge']).default('abort').description('单聊忙时：默认打断前一条直接接新话'),
        group: Schema.union(['queue', 'drop', 'abort', 'merge']).default('queue').description('群聊忙时：默认排队，一条条来'),
        post: Schema.union(['queue', 'drop', 'abort', 'merge']).default('queue').description('团队帖子忙时：默认排队'),
    }).description('同一会话多条消息的处理方式'),
    reactions: Schema.object({
        enabled: Schema.boolean().default(true).description('收到消息先挂表情回执：在算 / 好了 / 出错'),
        inGroup: Schema.boolean().default(true).description('群聊里也挂表情回执（默认给，省得以为机器人卡死）'),
        ack: Schema.string().default('👀').description('收到时挂的表情（留空 = 不挂）'),
        done: Schema.string().default('✅').description('处理完换成的表情（留空 = 只撤不换）'),
        fail: Schema.string().default('😵').description('出错换成的表情（留空 = 只撤不换）'),
    }).description('表情回执'),
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
    historyLimit: Schema.number().default(50).description('群历史缓冲条数'),
    access: AccessControlSchema.default({
        c2cMode: 'open',
        c2cAllow: [],
        c2cBlock: [],
        groupMode: 'open',
        groupAllow: [],
        groupBlock: [],
        postMode: 'disabled',
        postAllow: [],
        postBlock: [],
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
        restrictPaths: Schema.boolean().default(false).description('是否限制可发送的文件路径（默认 false：想发什么发什么；打开后仅允许 media + cwd + extraRoots）'),
        extraRoots: Schema.array(Schema.string()).default([]).description('额外允许访问的根目录'),
        sendPresentedFiles: Schema.boolean().default(true).description('是否将 present 声明的交付文件发送到当前会话'),
        maxFiles: Schema.number().default(4).description('单轮最多投递的交付文件数'),
    }).default({ restrictPaths: false, extraRoots: [], sendPresentedFiles: true, maxFiles: 4 }).description('附件发送配置'),
    interactive: Schema.object({
        enabled: Schema.boolean().default(true).description('是否使用推推原生交互卡片（问答/审批）'),
        headBgColor: Schema.string().default('#1F6FEB').description('卡片头部背景色'),
        headTextColor: Schema.string().default('#FFFFFF').description('卡片头部文字颜色'),
        approvalTimeoutMs: Schema.number()
            .default(300000)
            .description('审批卡片等待上限（毫秒，0 = 不限）。超时按 cancelled 结算，避免会话永久悬挂'),
    })
        .default({ enabled: true, headBgColor: '#1F6FEB', headTextColor: '#FFFFFF', approvalTimeoutMs: 300000 })
        .description('交互卡片配置'),
    agentSteps: Schema.object({
        enabled: Schema.boolean().default(false).description('是否上报模型/工具调用中间步骤（默认关闭）'),
        includeToolPayload: Schema.boolean().default(false).description('是否上报完整工具参数与结果'),
        maxResultChars: Schema.number().default(800).description('工具结果截断字符数'),
    }).default({ enabled: false, includeToolPayload: false, maxResultChars: 800 }).description('Agent 步骤上报配置'),
    apiBaseUrl: Schema.string().description('推推 OpenAPI 地址（私有化部署覆盖）'),
    websocketBaseUrl: Schema.string().description('推推 WebSocket 地址（私有化部署覆盖）'),
});
//# sourceMappingURL=config.js.map
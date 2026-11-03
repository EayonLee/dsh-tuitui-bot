# dsh-tuitui-bot 移植设计（Lead 权威契约）

> 目标：把 `@tencent-connect/dsh-qqbot`（下称"上游"）**等结构**移植为 360 推推 IM 的 dsh 插件。
> 源码参考：`/tmp/ref/dsh-qqbot/src`（只读）。推推 SDK：`@qihoo/tuitui-bot-sdk@1.0.24`（`node_modules` 内）。

## 0. 铁律

1. **严格照上游结构**：目录、模块职责、类名/函数名、配置项语义、命令名、测试文件，一一对应；只有传输层（QQ SDK → 推推 SDK）替换。
2. 每个模块先读上游对应文件，再改写。**不要凭空设计新架构**，不要引入上游没有的抽象层。
3. 代码必须能 `npx tsc --noEmit` 通过（strict + noUnusedLocals + noUncheckedIndexedAccess）；纯逻辑模块要有 vitest 单测（移植上游同名测试）。
4. 注释用中文、风格与上游一致（文件头一段说明 + 关键决策解释"为什么"）。
5. 推推能力优先：能自然用上推推原生能力的地方（交互卡片、modifyText 流式编辑、agent 步骤上报、emoji reaction、快捷指令）就用，但不得破坏上游的语义与配置契约。
6. 写文件前确认该文件在你的 write scope 内；公共契约改动必须先在任务里说明并通知 Lead。

## 1. 角色映射（QQ → 推推）

| 上游（QQ） | 本插件（推推） |
|---|---|
| `ChatScope = 'c2c' \| 'group'` | `'c2c' \| 'group' \| 'post'`（`post` = 团队频道帖子 teams post） |
| `user_openid` / `group_openid` | `account`（域账号，主键）/ `uid` / `group_id` / `team_id+channel_id+post_id` |
| `msg_id` 被动回复（5 分钟 / 4 次限额） | 无被动回复限额；`sendText({ referenceMessageId })` 引用回复 |
| `bot.openStream()` 流式 | `im.sendInteractive`/`sendText` 拿到 `msgid` 后 `im.modifyText({ messageId, withoutPush: true })` |
| `InlineKeyboard` + `INTERACTION_CREATE` | 原生交互卡片 `im.sendInteractive` + `interactive_action` 事件 + `im.modifyInteractive` 原地更新 |
| `channel`（频道） | 团队帖子 `teams.sendPost` / `editPost` / `emojiReaction` |
| `sendMarkdown` | `im.sendText`（支持 Markdown） |
| typing indicator | `im.emojiReaction`（收消息回执）|
| 扫码绑定 `qrcode` | 无扫码：凭据手填 + `property.info()` 在线校验 + 端内设置页 |

## 2. 目录结构（与上游一一对应）

```
src/
├── index.ts                 # cordis 入口（Lead）
├── config.ts                # schemastery 配置（Lead）
├── types.ts                 # 内部类型/契约（Lead）
├── types-augment.d.ts       # client 类型增强（Lead）
├── tuitui/                  # ★ 新：推推渠道适配（Lead）
│   ├── client.ts            #   凭证→TuituiBotClient 构造、端点覆盖、UA
│   ├── inbound.ts           #   TuituiEventBody → InboundMessage 归一化
│   ├── sender.ts            #   TuituiSender 实现（发文本/卡片/文件/编辑/撤回/reaction）
│   ├── agent-reporter.ts    #   client.agent 步骤上报（工具调用展示）
│   └── shortcut.ts          #   启动时同步快捷指令（/help 可发现）
├── gateway/
│   ├── bootstrap.ts         # 网关组装（Lead）
│   ├── middleware-setup.ts  # 中间件编排（Lead）
│   ├── index.ts             # 导出
│   └── middleware/          # ★ 自研中间件内核 + 内置链（W2）
│       ├── kernel.ts        #   use()/dispatch() 洋葱模型 + errorHandler
│       ├── message-filter.ts access-policy.ts history-buffer.ts mention-gate.ts
│       ├── content-sanitizer.ts rate-limiter.ts slash-command.ts question-answer.ts
│       ├── concurrency-guard.ts typing-indicator.ts quote-ref.ts attachment.ts
│       └── envelope-formatter.ts
├── transport/               # 出站/入站传输（W4）
│   ├── inbound.ts outbound.ts chunker.ts streaming-writer.ts outbound-buffer.ts
│   ├── reply-target.ts reply-limiter.ts msgid-cache.ts events.ts
│   ├── deliverables.ts attachment.ts tool-presenter.ts index.ts
├── session/                 # 会话管理（W3）
│   ├── session-manager.ts idle-evictor.ts session-id.ts types.ts index.ts
├── host/adapter.ts          # 宿主 API 适配（W3）
├── model/                   # 模型/preset 解析（W3）
│   ├── types.ts model-resolver.ts prefs-store.ts settings-reader.ts index.ts
├── features/                # 审批/问答/历史（W5）
│   ├── approval-channel.ts question-channel.ts approval-renderer.ts question-renderer.ts
│   ├── answer-parser.ts history-store.ts button-utils.ts
├── commands/                # 斜杠命令（W5）
│   ├── index.ts help.ts status.ts model.ts preset.ts session.ts auth.ts misc.ts types.ts
├── media/                   # 富媒体（W6）
│   ├── send-media.ts send-file-tool.ts vision-tool.ts media-cleaner.ts
├── setup/                   # 凭据绑定/端内设置（W6）
│   ├── index.ts binding-service.ts persist.ts presenters.ts bind-routes.ts
├── shared/                  # 工具（Lead）
│   ├── index.ts utils.ts dirs.ts scope.ts send-helper.ts bind-protocol.ts
└── client/                  # 浏览器端 UI（W6）
    ├── index.ts config-panel.ts bind-page.ts
```

## 3. 公共契约（**不要改，除非全组同意**）

`src/types.ts`：

```ts
export type ChatScope = 'c2c' | 'group' | 'post';

export interface ReplyTarget {
  scope: ChatScope;
  targetId: string;          // c2c: account（无则 uid）；group: group_id；post: channel_id
  msgId?: string;            // 最近入站 msgid（引用回复 / 编辑）
  eventId?: string;          // interactive_action 的事件标识（无 msgid 时兜底）
  teamId?: string;           // post 专用
  channelId?: string;        // post 专用
  postId?: string;           // post 专用
  parentPostId?: string;     // post 回复
  at?: string[];             // 群聊 @（account/姓名）
}

export interface InboundAttachment {
  kind: 'image' | 'file' | 'voice' | 'video';
  filename?: string;
  url?: string;
  mimeType?: string;
  size?: number;
  fileId?: string;
  asrText?: string;
}

export interface InboundReference {
  text?: string;
  senderName?: string;
  senderAccount?: string;
  attachments?: InboundAttachment[];
  sharedPostId?: string;
}

export interface InboundPostRef {
  teamId: string;
  channelId: string;
  postId: string;
  parentId?: string;
  teamName?: string;
  channelName?: string;
  isReply: boolean;
}

export interface InboundMessage {
  eventType: string;         // single_chat | group_chat | teams_post_create | interactive_action
  kind: ChatScope;
  senderId: string;          // uid
  senderAccount: string;     // 域账号
  senderName: string;
  content: string;           // 正文（清洗后）
  messageId: string;         // msgid / post_id / 交互事件 id
  timestamp: string;
  groupId?: string;
  groupName?: string;
  atMe?: boolean;
  at?: Array<{ isAtAll: boolean; account?: string; uid?: string; name?: string }>;
  reference?: InboundReference;
  attachments: InboundAttachment[];
  post?: InboundPostRef;
  fromBot?: boolean;
  raw: unknown;
}

export interface MiddlewareState {
  quote?: { text?: string; senderName?: string; attachments?: InboundAttachment[] };
  history?: Array<{ senderId: string; senderName?: string; content: string; timestamp: number; messageId: string }>;
  envelope?: string;
  mention?: { wasMentioned?: boolean };
  processedAttachments?: ProcessedAttachment[];
  downloadedFiles?: DownloadedFile[];
  downloadedQuoteFiles?: DownloadedFile[];
  answeredQuestion?: boolean;
  [key: string]: unknown;
}

export interface MiddlewareContext {
  message: InboundMessage;
  state: MiddlewareState;
  replyTarget: ReplyTarget;
  bot: TuituiSender;
  /** 中断后续中间件与入站处理（如：被门控、被命令消费、重复消息） */
  skip(reason: string): void;
  readonly skipped: string | undefined;
}

export type Middleware = (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void>;
```

`src/tuitui/sender.ts`（出站原语，中间件/命令/工具都通过它发消息）：

```ts
export interface SendResult { msgId?: string }
export interface StreamSessionLike {
  update(content: string): Promise<void>;
  complete(): Promise<void>;
}
export interface TuituiSender {
  sendMarkdown(target: ReplyTarget, content: string, opts?: { keyboard?: TuituiCard; at?: string[] }): Promise<SendResult>;
  openStream(target: ReplyTarget): StreamSessionLike | null;   // 拿不到 msgid 时返回 null（降级静态发送）
  sendInteractive(target: ReplyTarget, card: TuituiOutboundInteractiveMessage): Promise<SendResult>;
  modifyInteractive(target: ReplyTarget, msgId: string, card: TuituiOutboundInteractiveMessage): Promise<void>;
  sendImage(target: ReplyTarget, source: MediaSource, opts?: { caption?: string; filename?: string }): Promise<SendResult>;
  sendFile(target: ReplyTarget, source: MediaSource, opts?: { filename?: string; caption?: string }): Promise<SendResult>;
  recall(target: ReplyTarget, msgId: string): Promise<void>;
  emojiReaction(target: ReplyTarget, msgId: string, emoji: string, cancel?: boolean): Promise<void>;
}
export type MediaSource = string | { data: Uint8Array; filename: string; contentType?: string };
```

> 上游有 `QQBotSender`（sendMarkdown/openStream）与 `MediaSenderLike`（sendImage/sendVideo/sendVoice/sendFile）。
> 本插件把它们**合并为 `TuituiSender`**（推推的视频/语音走 sendFile 同一路径），调用方签名保持兼容：
> `transport/outbound-buffer.ts` 继续只依赖 `{ sendMarkdown, openStream }` 的结构子集。

## 4. 中间件约定（W2）

- `kernel.ts` 导出 `class MiddlewareKernel { use(mw); async dispatch(ctx) }`，洋葱模型，`ctx.skip(reason)` 之后所有 `next()` 直接返回。
- 每个中间件是工厂函数：`export function accessPolicy(opts: {...}): Middleware`。
- `gateway/middleware-setup.ts`（Lead 写）按上游相同顺序编排；顺序不可改。
- 命令注册表由 `commands/buildCommandList()`（W5）提供，`slashCommand` 消费它。

## 5. 各工作流边界

| 工作流 | 写入范围 | 参考上游文件 |
|---|---|---|
| W1 Lead | `src/index.ts` `src/config.ts` `src/types.ts` `src/shared/**` `src/tuitui/**` `src/gateway/bootstrap.ts` `src/gateway/middleware-setup.ts` `src/gateway/index.ts` 根配置/文档 | index.ts config.ts shared/** gateway/** |
| W2 | `src/gateway/middleware/**`（+ 单测） | 上游 `@tencent-connect/qqbot-nodejs` 中间件语义 + transport/inbound 对 state 的消费 |
| W3 | `src/session/**` `src/host/**` `src/model/**`（+ 单测） | session/** host/adapter.ts model/** |
| W4 | `src/transport/**`（+ 单测） | transport/** |
| W5 | `src/features/**` `src/commands/**`（+ 单测） | features/** commands/** |
| W6 | `src/media/**` `src/setup/**` `src/client/**` `locale/**` | media/** setup/** client/** |

依赖方向：W5/W6 依赖 W3 的 `SessionManager` 公共方法与 W4 的 `TuituiSender` 契约；
W4 依赖 W2 的 `MiddlewareContext` 形态（见 §3）。**只依赖 §3 契约与上游源码，不要跨 scope 改文件。**

## 6. 配置（`src/config.ts`，Lead 写）

`appId` `appSecret` `provider` `model` `preset` `cwd` `requireMention` `groupPrompt` `directPrompt`
`postPrompt` `textChunkLimit` `streaming` `streamIntervalMs` `sessionIdleTimeout` `maxQueue`
`processingTimeoutMs` `askTimeoutMs` `historyLimit` `access{c2cMode,c2cAllow,groupMode,groupAllow,postMode,postAllow}`
`showToolResults` `debug` `media{enabled,maxMB,ttlHours}` `vision{...}` `sendFile{...}`
`interactive{enabled}` `agentSteps{enabled}` `apiBaseUrl` `websocketBaseUrl`

环境变量：`TUITUI_BOT_APPID` `TUITUI_BOT_SECRET` `TUITUI_BOT_API_BASE` `TUITUI_BOT_WS_BASE`。

## 7. 验收

1. `npx tsc --noEmit` 0 error；`npm run build` 产出 `lib/index.js` + `lib/client.js`。
2. `npx vitest run` 全绿（纯逻辑模块单测）。
3. `node scripts/smoke-live.mjs`：用真实凭据验证 `property.info()` + WS 连接 + 一次真实收发（群 `鱼塘`）。
4. `npx dsh --profile tuitui --dump-config` 能看到 `# == @qihoo/dsh-tuitui-bot` 层。
5. README（中/英）、CHANGELOG、locale 齐全。
---

## 8. 实现期决策记录（与上游的差异，落地后回填）

| 议题 | 决策 | 理由 |
|---|---|---|
| 会话键 | `tuitui:<scope>:<peerId>`（不含 appId） | 设计期约定；post 用 channelId，同频道多帖共用一会话 |
| 作用域 prompt | `c2c→directPrompt`、`group→groupPrompt`、`post→postPrompt`，section `tuitui:scope-prompt` | 比上游多一个 post 作用域 |
| 绑定流程 | 手填 appId/appSecret → `property.info()` 在线校验 → 写 profile patch → 热重载 | 推推无扫码协议 |
| 流式 | 首条发送拿 msgid，随后 `im.modifyText({withoutPush:true})`；拿不到 msgid 或 uid 目标时降级静态发送 | `modifyText` 只接受 account 目标 |
| 交互卡片 | `im.sendInteractive` + `interactive_action` + `im.modifyInteractive`；帖子降级为 markdown 文本 | 推推卡片能力仅单聊/群聊 |
| 媒体归一化 | 自研：优先 `_tuitui_media` 影子字段，回退 `images/voice/video/file` | SDK 只在 `dist/events` 导出该函数，包 exports 未开放；避免依赖内部路径 |
| 并发中断 | `concurrencyGuard.onInterrupt` → `record.agent.cancel({kind:'user'})` | MiddlewareContext 无 AbortSignal；只停链会让 token 继续烧 |
| 限流默认值 | perSender 30/min、perGroup 120/min、global 600/min（可传 `false` 关闭） | 上游裸调用等于不限流；这里只防机器人自激循环 |
| 语音转写 | `state.processedAttachments[].voiceText` 由 `attachmentProcessor` 从 `asr_refer_text` 补齐 | `downloadMessageMedia` 只回下载结果，不回转写 |
| 客户端 | 设置页 `settings.section` + 右侧栏 tab（`slots` / `sidebarRight` / `sidebarRightTabs`） | 与上游一致的席位契约，bundle 用 `window.__ModuleLoader__.load({id, factory})` |
| 原生步骤上报 | `client.agent.report.*`，默认不含工具参数/结果 | 推推独有能力，QQ 只能用文本模拟 |
| 超时/闲置 | `processingTimeoutMs`、`sessionIdleTimeout` 与上游同义 | 会话回收由 `IdleEvictor` 驱动 |


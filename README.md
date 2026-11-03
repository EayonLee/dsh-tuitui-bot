<div align="center">

<img src="./assets/icons/tuitui.svg" width="96" alt="Tuitui Bot" />

**基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 的 360 推推机器人插件**

在推推（Tuitui）**单聊、群聊、团队频道帖子**里直接对话 DeepSeek Harness。

[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.2.1--rc.5-8A2BE2)](https://github.com/deepseek-ai/deepseek-harness)
[![node](https://img.shields.io/badge/node-%3E%3D20.3-339933)](https://nodejs.org)

**简体中文 | [English](./README_EN.md)**

</div>

---

## 这是什么

把推推机器人做成 dsh 的一个**渠道前端**：推推消息 → 归一化 → 中间件链 → dsh Agent；
dsh 的文本/工具/审批/问答/交付物 → 推推消息、原生交互卡片、原地编辑流式输出。

结构上与腾讯官方的 `@tencent-connect/dsh-qqbot`（QQ 插件）**一一对应**：同样的目录分层、
同样的中间件顺序、同样的会话/命令/审批/问答语义，只是把 QQ Bot 传输层换成了推推 SDK
（[`@qihoo/tuitui-bot-sdk`](https://www.npmjs.com/package/@qihoo/tuitui-bot-sdk)）。

### 功能一览

| 能力 | 说明 |
| --- | --- |
| 💬 三种会话形态 | 单聊、群聊（@bot 触发）、团队频道帖子（含回帖串） |
| ⚡ 流式输出 | 首条消息拿到 `msgid` 后用 `modifyText(without_push)` 原地刷新，不刷屏 |
| 🃏 原生交互卡片 | 审批 / 提问用推推交互卡片，点击后 `modifyInteractive` 原地更新为最终状态 |
| 🖼️ 富媒体理解 | 图片/文件/语音/视频落地到本地媒体目录，交给 agent 读取（视觉工具可选） |
| 📎 文件回传 | `tuitui_send_file` 工具 + `present` 交付物自动投递到当前会话 |
| 🧭 上下文感知 | 群历史缓冲、引用消息解析、发送者部门路径、@ 标记清洗 |
| 🧩 斜杠命令 | `/new` `/compact` `/model` `/preset` `/status` `/stop` 等，同步为推推快捷指令 |
| 🧠 原生步骤上报 | 通过 `client.agent` 上报模型/工具调用，推推客户端原生展示执行过程 |
| 🔐 三种访问模式 | open / allowlist / disabled，单聊/群聊/帖子分别配置 |
| 🛠️ 端内绑定 | 设置页手填 appId/appSecret → `property.info()` 在线校验 → 写入 profile |

## 快速开始

### 1. 准备机器人凭据

在推推机器人后台创建机器人，拿到 **AppID** 与 **AppSecret**。

### 2. 安装插件

```bash
# 一键安装脚本（自动选包、建 profile、提示配置）
sh install.sh

# 从 GitHub 直接安装（仓库内已提交构建产物 lib/，无需本地构建）
dsh plugin --profile tuitui add github:EayonLee/dsh-tuitui-bot

# 从 npm 安装（发布后可用）
dsh plugin --profile tuitui add @qihoo/dsh-tuitui-bot

# 或从本地源码 / tarball 安装
dsh plugin --profile tuitui add /path/to/dsh-tuitui-bot
npm pack && dsh plugin --profile tuitui add ./qihoo-dsh-tuitui-bot-0.1.0.tgz
```

### 3. 配置凭据并启动

```bash
export TUITUI_BOT_APPID="你的AppID"
export TUITUI_BOT_SECRET="你的AppSecret"
export DEEPSEEK_API_KEY="你的 DeepSeek Key"

dsh --profile tuitui            # 启动 agent + 推推长连接
```

> 也可以不配环境变量：直接启动后在 **设置 → 推推机器人** 里填写 appId/appSecret，
> 插件会调用 `property.info()` 校验并把凭据写进 profile 的 `cordis.patch.yml`。

### 4. 在推推里聊

- 私聊机器人：直接发消息
- 群聊：把机器人拉进群，`@机器人 你的问题`（`mentionPolicy` 默认 `require`；改成 `smart` 后不 @ 也会回，但只回引用机器人/叫到名字/刚聊过的人追问的消息；改成 `always` 则全部回）
- 团队频道：在频道里发帖并 `@机器人`（或回复机器人的帖子）

## 配置

配置项定义在 [`src/config.ts`](./src/config.ts)，可在 profile 的 `cordis.patch.yml` 中覆盖
（**patch 是整体替换 config，需写全你要保留的键**）。

### 基础

| 配置 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `appId` | string | `''` | 推推机器人 AppID（可用 `TUITUI_BOT_APPID`） |
| `appSecret` | string | `''` | 推推机器人 AppSecret（可用 `TUITUI_BOT_SECRET`） |
| `provider` / `model` | string | - | 覆盖 LLM 路由；留空继承宿主默认，可 `/model` 切换 |
| `preset` | string | - | Agent preset id（新会话生效） |
| `cwd` | string | `~/.dsh-tuitui/workspace` | Agent 工作目录 |
| `requireMention` | boolean | `true` | 群聊是否必须 @bot（`mentionPolicy` 未设置时用它推导） |
| `requireMentionInPost` | boolean | `true` | 团队帖子是否必须 @bot |
| `mentionPolicy` | `require` | `require` / `always` / `smart` | 触发方式：仅 @ / 全部 / 智能（只回相关消息） |
| `botAliases` | `[]` | smart 模式：出现这些名字即视为在叫机器人 |
| `smartFollowUpMs` | `120000` | smart 模式：机器人回复后同一个人追问的延续窗口 |
| `groupPrompt` / `directPrompt` / `postPrompt` | string | - | 按作用域追加的 system prompt |
| `textChunkLimit` | number | `4000` | 单条消息最大字符数 |
| `debug` | boolean | `false` | 调试日志（含原始事件体） |

### 会话与并发

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `streaming` | `true` | 流式输出（原地编辑） |
| `streamIntervalMs` | `600` | 流式刷新节流 |
| `sessionIdleTimeout` | `1800000` | 会话闲置回收（ms） |
| `maxQueue` | `20` | 同 peer 消息队列上限 |
| `processingTimeoutMs` | `1800000` | 单轮处理超时（ms） |
| `askTimeoutMs` | `300000` | 待答问题超时（ms） |
| `historyLimit` | `10` | 群/帖子历史缓冲条数 |
| `showToolResults` | `false` | 是否展示工具成功结果（错误始终展示） |

### 访问控制

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `access.c2cMode` | `open` | `open` / `allowlist` / `blocklist` / `disabled` |
| `access.c2cAllow` / `c2cBlock` | `[]` | 单聊白名单 / **黑名单**（域账号或 UID，黑名单优先） |
| `access.groupMode` | `open` | 群聊模式（同上四档） |
| `access.groupAllow` / `groupBlock` | `[]` | 群白名单 / **黑名单**（group_id） |
| `access.postMode` | `open` | 团队帖子模式（同上四档） |
| `access.postAllow` / `postBlock` | `[]` | 帖子白名单 / **黑名单**（channel_id 或 team_id） |

> `allowlist` 模式下名单为空 = **拒绝所有人**（fail-closed）。

### 富媒体 / 视觉 / 附件

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `media.enabled` | `true` | 是否下载并理解富媒体 |
| `media.maxMB` | `200` | 单文件上限（MB） |
| `media.ttlHours` | `24` | 媒体保留时长，0 = 永久 |
| `vision.enabled` | `false` | 启用 `tuitui_describe_image` 工具 |
| `vision.provider` / `vision.model` | - | 视觉模型路由 |
| `sendFile.restrictPaths` | `true` | 路径白名单（media + cwd + extraRoots） |
| `sendFile.extraRoots` | `[]` | 额外允许发送的目录 |
| `sendFile.sendPresentedFiles` | `true` | 轮末投递 `present` 声明的文件 |

### 推推原生能力开关

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `interactive.enabled` | `true` | 用交互卡片做审批/提问（关闭后走编号文本应答） |
| `interactive.headBgColor` / `headTextColor` | `#1F6FEB` / `#FFFFFF` | 卡片头部配色 |
| `agentSteps.enabled` | `true` | 上报模型/工具步骤给推推客户端原生展示 |
| `agentSteps.includeToolPayload` | `false` | 是否上报工具参数/结果原文 |
| `agentSteps.maxResultChars` | `800` | 工具结果截断长度 |
| `apiBaseUrl` / `websocketBaseUrl` | - | 私有化部署端点覆盖（亦可用 `TUITUI_BOT_API_BASE` / `TUITUI_BOT_WS_BASE`） |

## 内置命令

| 命令 | 说明 |
| --- | --- |
| `/new`（别名 `/reset` `/clear`） | 开始新会话（清空上下文） |
| `/compact` | 压缩会话历史（摘要替换旧记录） |
| `/model` | 查看或切换模型 |
| `/preset` | 查看或切换 agent preset（新会话生效） |
| `/status` | 当前会话状态（会话 id、模型、preset、消息数） |
| `/stop` | 中止当前生成 |
| `/bot-ping` | 延迟检测（传输 + 处理耗时） |
| `/bot-version` | 版本信息 |
| `/bot-help` | 全部命令 |
| `/auth` | 访问控制自检（当前 peer 是否被允许） |

> 常用命令会同步到推推的**快捷指令**面板，用户无需记忆。

## 工具

| 工具 | 说明 |
| --- | --- |
| `tuitui_send_file` | 把本地文件/URL/内存内容发到当前会话（走路径白名单） |
| `tuitui_describe_image` | 视觉理解（需 `vision.enabled`，复用 dsh llm + attachments） |

## 架构

```
推推事件 (WebSocket)
   │  src/tuitui/inbound.ts      归一化：single_chat / group_chat / teams_post_create / interactive_action
   ▼
中间件洋葱 (src/gateway/middleware/)
   errorHandler → messageFilter → accessPolicy → historyBuffer → mentionGate →
   contentSanitizer → rateLimiter → slashCommand → questionAnswer →
   concurrencyGuard → typingIndicator → quoteRef → attachmentProcessor → envelopeFormatter
   ▼
src/transport/inbound.ts   5 层组装（用户内容/引用/发送者标签/媒体元数据/历史 envelope）→ agent.followup
   ▼
dsh Agent（session/**、host/**、model/**）
   ▼
dsh 事件 (session/event, agent/assistant-stream)
   │  src/transport/{outbound,streaming-writer,outbound-buffer,tool-presenter,deliverables}.ts
   ▼
src/tuitui/sender.ts   im.sendText / modifyText / sendInteractive / modifyInteractive / sendFile / recall / emojiReaction
                       teams.sendPost / editPost / sendFile / emojiReaction
```

关键设计：**全插件只有 `src/tuitui/` 直接 import 推推 SDK**，其余模块只依赖
[`src/types.ts`](./src/types.ts) 里的 `TuituiSender` 抽象，便于替换与测试。

## 开发

```bash
npm install
npm run typecheck        # tsc --noEmit
npm test                 # vitest（纯逻辑模块单测）
npm run build            # tsc → lib/ + tsdown → lib/client.js（浏览器端面板）

# 真实环境冒烟（真实凭据验证：事件归一化 / 凭据 / 长连接 / 发送 / 编辑 / 撤回）
TUITUI_BOT_APPID=xxx TUITUI_BOT_SECRET=yyy node scripts/smoke-live.mjs
node scripts/smoke-live.mjs --send group:<groupId>      # 额外做真实收发 + 编辑 + 撤回

# 启动接线自检（不需要 dsh CLI / LLM Key：验证客户端、发送器、中间件链、工具注册、
# WS 订阅、property.info 自检、快捷指令同步、生命周期清理整条接线）
TUITUI_BOT_APPID=xxx TUITUI_BOT_SECRET=yyy node scripts/verify-bootstrap.mjs
```

本地调试（不装包，直接用源码，dsh ≥ 0.2.1 用 `--patch` 叠加层）：

```bash
dsh web --patch /path/to/dsh-tuitui-bot/cordis.dev.yml
```

> 本插件的 bundle 层会随 `dsh plugin --profile <name> add` 自动生效；
> 用 `dsh --profile <name> --dump-config` 可以确认 `im-tuitui` 行已进入组合树。

## 贡献

欢迎提 issue / PR，动手前请先读 [贡献指南](./CONTRIBUTING.md)：

- Bug 请用 [Bug 报告](https://github.com/EayonLee/dsh-tuitui-bot/issues/new?template=bug_report.yml) 模板，附上 dsh 版本、插件版本与脱敏日志；
- 功能建议请用 [功能建议](https://github.com/EayonLee/dsh-tuitui-bot/issues/new?template=feature_request.yml) 模板，说明推推侧可复用的原生能力；
- 提交前请跑通 `npm run typecheck`、`npm test`、`npm run build`；
- 参与即表示遵守 [行为准则](./CODE_OF_CONDUCT.md)；安全漏洞请按 [SECURITY.md](./SECURITY.md) 私下报告，不要开公开 issue。

变更记录见 [CHANGELOG.md](./CHANGELOG.md)（英文：[CHANGELOG_EN.md](./CHANGELOG_EN.md)）。

## 致谢

- 结构与行为语义参考 [@tencent-connect/dsh-qqbot](https://github.com/tencent-connect/dsh-qqbot)（MIT）；
- 宿主框架 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)；
- 推推开放平台 [@qihoo/tuitui-bot-sdk](https://www.npmjs.com/package/@qihoo/tuitui-bot-sdk)。

## 许可

[MIT](./LICENSE) © 2026 EayonLee and dsh-tuitui-bot contributors

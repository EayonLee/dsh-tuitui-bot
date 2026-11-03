# Changelog

本项目（`@eayonlee/dsh-tuitui-bot`）是 `@tencent-connect/dsh-qqbot` 的推推移植版，版本号独立演进。

## 0.1.0

首个版本：把 QQ Bot 渠道插件等结构移植为 360 推推机器人渠道插件。

### 新增

- **推推渠道适配（`src/tuitui/`）**
  - `client.ts`：凭据/端点（`TUITUI_BOT_API_BASE`、`TUITUI_BOT_WS_BASE` 覆盖）/SDK 日志适配
  - `inbound.ts`：`single_chat`、`group_chat`、`teams_post_create`、`interactive_action` 归一化
  - `sender.ts`：`TuituiSender` 实现（文本/交互卡片/文件/原地编辑/撤回/emoji reaction，帖子走 `teams`）
  - `agent-reporter.ts`：`client.agent` 原生步骤上报
  - `shortcut.ts`：启动时同步推推快捷指令
- **自研中间件内核（`src/gateway/middleware/`）**：洋葱内核 + 13 个中间件，语义对齐 QQ SDK 内置链
- **会话层（`src/session/`、`src/host/`、`src/model/`）**：单飞创建、闲置回收、preset/model 偏好持久化、三作用域 system prompt
- **传输层（`src/transport/`）**：markdown 感知切分、流式写入器、出站缓冲、工具展示、交付物投递、附件下载
- **审批/问答（`src/features/`）**：推推原生交互卡片 + 文本编号兜底
- **命令（`src/commands/`）**：`/new` `/compact` `/model` `/preset` `/status` `/stop` `/bot-ping` `/bot-version` `/bot-help` `/auth`
- **富媒体（`src/media/`）**：`tuitui_send_file`、`tuitui_describe_image`、媒体 TTL 清理
- **端内绑定（`src/setup/`、`src/client/`）**：手填凭据 + `property.info()` 校验 + 写入 profile + 设置面板

### 与 QQ 版的差异

- 新增 `post` 作用域（团队频道帖子），会话键 `tuitui:post:<channelId>`
- 移除 QQ 被动回复限额（`reply-limiter` 改作出站节流/重复内容守卫）
- 流式输出改为"首条发送拿 msgid + `modifyText`"，拿不到 msgid 时降级为静态发送
- 绑定流程由扫码改为凭据手填 + 在线校验

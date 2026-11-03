# Changelog

本项目（`@eayonlee/dsh-tuitui-bot`）是 360 推推 IM 的 dsh 渠道插件，版本号独立演进。

## 0.1.0

首个版本：面向 360 推推 IM 的 dsh 机器人渠道插件的首版实现。

### 新增

- **推推渠道适配（`src/tuitui/`）**
  - `client.ts`：凭据/端点（`TUITUI_BOT_API_BASE`、`TUITUI_BOT_WS_BASE` 覆盖）/SDK 日志适配
  - `inbound.ts`：`single_chat`、`group_chat`、`teams_post_create`、`interactive_action` 归一化
  - `sender.ts`：`TuituiSender` 实现（文本/交互卡片/文件/原地编辑/撤回/emoji reaction，帖子走 `teams`）
  - `agent-reporter.ts`：`client.agent` 原生步骤上报
  - `shortcut.ts`：启动时同步推推快捷指令
- **自研中间件内核（`src/gateway/middleware/`）**：洋葱内核 + 13 个中间件，覆盖过滤、历史、门控、清洗、限流、命令、并发等入站环节
- **会话层（`src/session/`、`src/host/`、`src/model/`）**：单飞创建、闲置回收、preset/model 偏好持久化、三作用域 system prompt
- **传输层（`src/transport/`）**：markdown 感知切分、流式写入器、出站缓冲、工具展示、交付物投递、附件下载
- **审批/问答（`src/features/`）**：推推原生交互卡片 + 文本编号兜底
- **命令（`src/commands/`）**：`/new` `/compact` `/model` `/preset` `/status` `/stop` `/bot-ping` `/bot-version` `/bot-help` `/auth`
- **富媒体（`src/media/`）**：`tuitui_send_file`、`tuitui_describe_image`、媒体 TTL 清理
- **端内绑定（`src/setup/`、`src/client/`）**：手填凭据 + `property.info()` 校验 + 写入 profile + 设置面板

- **智能插话（`src/features/smart-judge.ts`）**：smart 模式下由模型读群聊上下文判断要不要开口；判定提示词可在设置页整段改写（默认值见 `src/shared/smart-prompt.ts`），带会话级冷却、超时与「失败即不插嘴」的兜底
- **设置页重做（`src/client/config-panel.ts`）**：分区卡片 + 两列字段网格（窄屏落单列）；白名单/黑名单与称呼改成标签输入（回车成标签、Backspace 删除、× 单删）；工作区改为下拉选择（服务端回传候选目录）；智能模式展开提示词编辑器；移除模型选择
- **服务范围改为作用域卡片**：单聊 / 群聊 / 帖子各自成块，模式用紧凑下拉切换，名单只在对应模式下出现（不再四档平铺 + 一堆不生效的名单行）；输出相关开关拆到独立的「输出与调试」段
- **品牌图标**：插件图标与设置页/绑定页/侧栏图标统一换成推推官方图标（内嵌 base64，bundle 自包含）

### 运行模型要点

- 新增 `post` 作用域（团队频道帖子），会话键 `tuitui:post:<channelId>`
- `reply-limiter` 是出站节流 / 重复内容守卫：同一 target 最小间隔 + 同内容短时去重，超限排队而非丢弃
- 流式输出改为"首条发送拿 msgid + `modifyText`"，拿不到 msgid 时降级为静态发送
- 绑定流程为凭据手填 + 在线校验
- 智能触发不再依赖「出现名字就回」的硬规则：模型判定优先，确定性规则只作为降级路径

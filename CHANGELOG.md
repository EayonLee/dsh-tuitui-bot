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
- **设置页重做（`src/client/config-panel.ts`）**：分区卡片 + 两列字段网格（窄屏落单列）；白名单/黑名单改成标签输入（回车成标签、Backspace 删除、× 单删）；工作区改为下拉选择（服务端回传候选目录）；智能模式展开提示词编辑器；移除模型选择
- **服务范围改为作用域卡片**：单聊 / 群聊 / 帖子各自成块，模式用紧凑下拉切换，名单只在对应模式下出现（不再四档平铺 + 一堆不生效的名单行）；输出相关开关拆到独立的「输出与调试」段
- **出站 @ 变成真 @**：正文里的 `@某某` 解析成推推 `at` 元数据（代码块/邮箱/`@all` 排除，与显式 at 合并去重）。以前只写文字，别的机器人根本收不到通知
- **并发四策略全部在回合层生效**：merge 以前等于 queue（配置项骗人），现在是真合并（忙时攒话，回合结束一次投递）；abort / drop / queue 也补齐了回合层执行
- **入站消息跨重启去重**：msgid 落盘 FIFO 1000，重启/重连后不重复回答
- **僵尸连接自愈**：连上后 30 分钟零事件 → 重建订阅；每 5 分钟打一行 `[tuitui/watch]` 状态
- **回合收敛上限 15 分钟**：卡死的 turn 不再永久占住会话槽位
- **判定输出改走工具 schema**：下发 `join_decision` 的 JSON Schema，按 schema 收参数；提示词里不再写「只输出一行 JSON」，格式归代码
- **判定超时 8s → 20s**、`maxTokens` 400 → 800：思考型模型经常卡在「还在想」被截断，日志里表现为 `why=unparsable`
- **超时单独记 `why=timeout`**，不再和解析失败混为一谈
- **并发策略可按作用域配**：群聊默认排队（一条条来），单聊默认打断（直接接新话），帖子默认排队；四个策略 queue / abort / merge / drop 在设置页选
- **设置页模块化**：配置按主题分卡片（各自背景），顶部导航点一下滚到对应块；行内说明一律收进 tooltip，页面不再堆段落
- **表情回执**：收到消息先挂 `👀`，处理完换 `✅`，出错换 `😵`，三档都可自定义、可关；群聊默认也给
- **智能模式可以只挂表情**：判定输出扩成 `text / emoji / silent` 三种动作，插不上话时挂个表情比硬憋一条文字自然
- **判定参数**：`maxTokens` 120 → 400（思考型模型要留够）、`cooldownMs` 20s → 5s
- **去掉「启用模型判断」开关与追问窗口**：智能模式只有一条路——模型按人格判断；模型不可用就不说话，不再退回「出现名字 / 刚聊过的人接着说话」这类确定性规则
- **默认值调整**：触发方式默认「智能」；群聊上下文与判定条数默认 50；中间步骤默认关；团队帖子默认禁用；发送文件默认不限制路径
- **去掉「称呼」配置**：别名匹配与人格设定冲突，智能判定改为完全交给模型 + 人格提示词
- **判定提示词重写**：不再是「拿不准就不插嘴」的清单，改成处境与动机（兴趣、情绪、无聊、手上有信息），让它自己拿主意
- **品牌图标**：插件图标与设置页/绑定页/侧栏图标统一换成推推官方图标（内嵌 base64，bundle 自包含）

### 运行模型要点

- 新增 `post` 作用域（团队频道帖子），会话键 `tuitui:post:<channelId>`
- `reply-limiter` 是出站节流 / 重复内容守卫：同一 target 最小间隔 + 同内容短时去重，超限排队而非丢弃
- 流式输出改为"首条发送拿 msgid + `modifyText`"，拿不到 msgid 时降级为静态发送
- 绑定流程为凭据手填 + 在线校验
- 智能触发不再依赖「出现名字就回」的硬规则：模型判定优先，确定性规则只作为降级路径

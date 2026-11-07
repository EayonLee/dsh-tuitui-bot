# Changelog

本项目（`@eayonlee/dsh-tuitui-bot`）是 360 推推 IM 的 dsh 渠道插件，版本号独立演进。

## 0.1.33 (2026-11-07)

本版主线：把 2026-11-06 全仓审计剩下的 P0/P1/P2 全部修完（#34–#49），并把安装文档里的
版本号彻底去掉。

### 文档

- 安装文档不再写死版本号：npm 一律 `add @eayonlee/dsh-tuitui-bot`（不写号 = 最新），
  Release 直链改走稳定文件名 `.../releases/latest/download/dsh-tuitui-bot.tgz`。照抄写死的
  `@0.1.32` 这类命令是「装成老版本」的主要来源，现在文档里不再出现具体版本号（固定版本才用
  `<版本>` 占位符说明）。`scripts/pack.sh` 同步产出稳定别名，发版时两个 asset 一起上传，
  AGENTS / CONTRIBUTING 的发版流程已按此对齐。
### 修复

- 一键更新在 Release 漏传带版本号的 asset 时会直接失败；现在退回稳定别名
  `dsh-tuitui-bot.tgz` 继续装，仍然只认这两种合法文件名（#64）。
- 附件发送的路径白名单默认收紧为开启（`sendFile.restrictPaths: true`），并且凭据文件
  （`cordis.patch.yml`）、私钥（`*.pem` / `*.key` / `~/.ssh`）、`.env` / `.npmrc` 以及
  `$DSH_HOME/profiles/**` 无论开关如何都拒绝发送。此前默认放开任意路径，群聊里的一次诱导
  就能把这些文件发进群（#34）。
- 并发合并（merge）策略下，被合并的非幸存消息在正文并入幸存者之后仍会被单独处理一遍，
  同一句话得到两条回复。现在非幸存消息显式 `skip('concurrency:merged')`，紧急插队释放的
  缓冲消息保持原行为（#35）。
- 设置页一键更新把 `file:` 依赖指向 `/tmp` 下装完即删的临时 tarball，导致更新成功之后该
  profile 里任何 `pnpm install` / `dsh plugin add` 都因 ENOENT 失败。现在先把 tarball 落到
  profile 内的 `.dsh-tuitui-updates/`（只留当前版本），再以稳定路径安装（#36）。
- 出站发送加了 15 秒超时：此前一次「连上了但永不返回」的请求会把该会话的发送串行链
  永久挂住，之后所有回复静默排队、交付物与轮末结算也不再推进。超时只解除阻塞并告警，
  不自动重试（避免已送达的消息重复）（#37）。
- 发送失败不再静默丢内容：每段回复带 2 次退避重试，仍失败时给用户发一条
  「⚠️ 有 N 段回复没能发出去」并记录失败段数与首段预览。此前 `finally` 无条件清空缓冲，
  回复直接消失、只剩一行 error 日志（#38）。
- 设置页的绑定/解绑/改配置/试模型路由补上「必须来自本机」校验（与「关于/更新」路由同一套
  判据）。此前只校验 Origin 同源，没有 Origin 头（curl、脚本）的请求直接放行，dsh 以
  `--host 0.0.0.0` 启动或挂在反代后面时，局域网内任何人都能替换凭据或解绑（#44）。
- 自动保存失败时的兜底引导不再把 AppSecret 明文 `console.log` 出去（stdout 在 `dsh web` 下
  会进 `~/.dsh/web.log`，systemd 下进 journal）。现在只回显 appId，secret 用占位符（#44）。
- 图像生成拿到的是 `url`（而不是 `b64_json`）时改为按二进制下载：此前用 `response.text()`
  取图再按 latin1 还原，PNG 的 `0x89` 等字节会被 UTF-8 解码破坏，出图必坏（#43）。
- `tuitui_describe_image` 不再接受私有网段/环回地址的 URL（SSRF），本地图片也限制在
  media / agent cwd / `sendFile.extraRoots` 之内，避免把任意文件送去外部视觉端点（#43）。
- merge 策略下锁不再提前释放：幸存者接手处理后续链之前，owner 已经把锁放掉、状态也清了，
  同一 peer 于是能跑出两条并发链（历史缓冲、会话归属互相踩）。现在锁显式交给幸存者，
  由它负责收尾（#39）。
- 中间件兜底捕获异常后显式结束这条链：此前既不抛出也不 skip，集成方会把同一条消息再正常
  处理一遍，用户先收到「处理异常」、紧接着又收到一条正常回答（#39）。
- 「待答问题 / 待批审批」的文本应答截获移到触发门控之前：群里回「1」「同意」通常不 @ 机器人，
  此前会被 @ 门控直接 skip，答案永远到不了通道，turn 挂到超时（#39）。
- 附件下载补三道闸：先看 `content-length` 超限就直接放弃、在响应流上边读边数超过
  `media.maxMB` 立刻断开（此前先 `arrayBuffer()` 整个读进内存再判断）、3xx 跳转手动跟
  且**每一跳**重新做 SSRF 校验（此前只校验首跳，一个 302 指向内网就绕过了）（#40）。
- 轮次因输出上限被截断（`max-tokens`）或被打断时，不再静默返回半截回答，会补一句
  「本轮回答达到输出上限被截断」之类的提示（#40）。
- 工具调用记录按会话在轮末清理：`tool/result` 不保证一定到达（轮次中断、工具崩溃），
  只靠 result 删除会让这张表在长跑进程里无限增长（#40）。
- `/model` 在正在生成回答时不再切换：那次 fork 会 dispose 掉在跑的 agent handle，用户眼前的
  回答直接断掉。现在先拒绝并提示「等它说完，或先 /stop」；没有活跃会话时改为明确回
  「下一条新会话生效」（#41）。
- `/new` 与「正在打开会话」的竞态修掉：resume/create 还没回来时 `/new` 换了会话，那条在飞的
  流程收尾会把旧 sessionId 写回 prefs、把旧记录塞回内存，等于把刚落地的 `/new` 覆盖掉（#41）。
- 卸载（`disposeAll`）先等在飞的 openSession 落地再清理，避免它们在清理之后把自己塞回
  会话表，留下没人管的野会话（#41）。
- 提问/审批超时或被取消后，那张卡片上的按钮原来一直可点（点下去只会得到「没有待答问题」，
  甚至把答案错位到下一题）。现在卡片会被改写成「已超时 / 已失效」，按钮明确不再生效（#42）。
- 修掉「发卡片期间就被 abort」的悬挂：signal 在 `await sendQuestion`（审批同理）期间触发时，
  listener 还没挂上，事件不会再来第二次，那一轮会一直挂到超时。现在挂完 listener 立刻
  复查 `signal.aborted` 并同时把待答项先入表（#42）。
- 设置页的「额外提示词」（`groupPrompt` / `directPrompt` / `postPrompt`）原来不在服务端可编辑白名单里，
  一保存就整批 400（同一次提交里改的其它配置也一起被拒）。现在三键进白名单，按提示词规则校验：
  最多 8000 字符、拒绝控制字符（#46）。
- `link:` 安装（贡献者本地开发）下反查 profile 目录的兜底把包名写死成 `@qihoo/dsh-tuitui-bot`，
  永远匹配不到，导致设置页只能看不能存（「无法定位 profile 目录」）。现在按
  `node_modules/@*/dsh-tuitui-bot` 扫描，换过的 scope 也能命中（#47）。
- 自回声重新拦住：中间件链此前显式 `skipSelfEcho: false`，而 c2c 没有 @ 门控——平台一旦把自己
  发的消息推回来就是自问自答死循环。现在默认开启，并加一条身份兜底（发送者==自己的 appId 也丢），
  命中的会打一条 info（正常情况下不该出现，出现即说明回声是真的）（#45）。
- 审批只认发起人：群里别人点「允许」不再替发起人授权，回一句「需要由发起人本人点」，且不消耗
  这次待批（`interactive.approvalRequesterOnly`，默认开；关掉恢复群里谁都能批）。提问仍是
  群里谁都能答、先答先算（#49）。
- 收掉一批网关杂项：限流桶空桶即删并在键数超上限时全表清理（不再给「发完就不再来」的 key 留空
  数组）；引用 LRU 覆盖已有 key 时不再多淘汰一条；团队帖子也会挂「在算」回执；bootstrap 里那份
  「skip 最后原因覆盖」的上下文实现删掉，统一用内核的「首个原因生效」（#48）。

### 破坏性变更

- 设置页的写动作（绑定 / 解绑 / 改配置 / 试模型）现在只接受**本机**发起的请求。用
  `--host 0.0.0.0` 或反向代理从别的机器打开 dsh Web 的话，这些操作会返回 403；
  远程管理请改用 SSH 端口转发（`ssh -L 3080:127.0.0.1:3080`）后在本机浏览器操作（#44）。

### 变更

- 安装方式收敛为**只有两种**：npm 包（`@eayonlee/dsh-tuitui-bot`）与 GitHub Release 直链
  （`.../releases/download/v<版本>/dsh-tuitui-bot-<版本>.tgz`）。升级、卸载同样只走这两条。
  移除 `github:EayonLee/dsh-tuitui-bot` 跟主干的安装说明，README / README_EN / AGENTS /
  CONTRIBUTING 全部对齐。

## 0.1.32 (2026-11-05)

一句话：GitHub API 被限流时，「检查更新」不再变成「检查失败」。

### 修复

- 检查更新接上 `releases.atom` 兜底：GitHub 未认证 API 是 60 次/小时**按 IP** 计的，
  办公网 NAT 出口很容易打满（实测 403 `API rate limit exceeded`）；atom 走网页域不吃这个限流，
  语义同样是「发布会」，API 挂了就用它，来源标注为「GitHub Release（Atom）」。
- 一键更新在 API 限流/断网时按版本号拼 Release 直链（`/releases/download/v<版本>/dsh-tuitui-bot-<版本>.tgz`），
  不再出现「看得到新版、点更新却报 403」；包名与版本仍由装前解包校验把关。

### 变更

- 本版起同时发布到 npm：`dsh plugin --profile <name> add @eayonlee/dsh-tuitui-bot`。
  `package.json` 去掉 `private`、加 `publishConfig`（锁官方源 + `access: public`），
  与 GitHub Release 同版本、同 `files` 白名单；README / AGENTS 的安装口径同步更新。

## 0.1.31 (2026-11-05)

一句话：设置页能看版本、能查更新，自己就能热更新，不用重启。

### 新增

- 设置页新增「关于」区块（#27）：GitHub 图标直达仓库、显示真正装进 profile 的版本号、
  一键检查线上最新版本（Release / 主干 / jsDelivr 多源取最大，6h 缓存，查不到如实报错）。
- 一键更新入口在「已绑定」状态行右侧（跟「更换凭据 / 解绑」同一行），不是独立配置区块；
  默认开启（`selfUpdate.enabled: false` 可只保留检查、禁用安装）。只从本仓库 Release 取
  `dsh-tuitui-bot-<版本>.tgz`，sha256 校验后备份旧目录再 `pnpm add`，装完补
  `dsh.profile.bundles`；宿主有 `@deepseek-ai/dsh-hmr` 时调 `reconcileProfile` 热重载，
  **进程不重启**；没有 HMR 明确提示需重启；任一步失败自动回滚旧版本。

### 变更

- 修复：`package.json` 里的 `dsh` 元数据（`bundle.patch` / `client.platform` / `compatibility`）
  和 `peerDependencies` 在 #19 整理文档时被误删，导致重装后 dsh 读不到 bundle patch，
  **整个插件不加载**（重启后表现为「插件没了」）。已全部恢复。
- `scripts/ship.sh` 装完会校验 profile 的 `dsh.profile.bundles` 包含本包，缺了就补，
  避免同一种「静默消失」再发生一次。
- 重启口径统一：仓库文档与脚本只写 `sudo systemctl restart dsh-web`，不再引用 `~/bin/dsh-restart`。
- 版本条体验修正（#27）：版本号完整展示不再省略；「检查更新」除检查/更新进行中外都可按，
  已是最新时点按会回执「已是最新（vX.Y.Z）」；待重启 / 检查失败（橙）、已是最新（绿）、
  本地更新（蓝）都有状态色，不再是一行灰字。
- 更新判定的兼容性加固（#27）：release 通道只信 Release 的 tag（不再混主干，避免提示一个
  没有 asset 的版本）；预发布 tag（`-beta.1` 这类）默认不算可更新；安装前解包核对包名、版本，
  并按目标包的 `dsh.compatibility.dshReleases` 校验当前宿主版本，不认的一律拒绝；`link:`
  开发软链安装直接拒绝更新，避免把源码链接换成打包产物。
- 新增配置项 `selfUpdate.enabled`（默认 `false`）与 `selfUpdate.channel`（`release` / `main`），
  设置页可改，写入 profile patch 后与其它配置一样经 HMR 生效。
- 入站可读性收尾（#18）：认不出来的消息类型不再变成空串，正文给
  `[未支持的消息类型: xxx]` 占位，同时 `logger.warn` 记下 `msg_type` / 会话 / `msgid`；
  `tuitui_history` 读不到正文时用同一套占位。合并转发、名片补夹具锁住 SDK 渲染分支。
- 文档与权限对齐（#18）：`tuitui_send` 的 `strong_notice` / `phone_alarm` 标注需单独申请接口权限；
  README 新增「能读什么、读不到什么」，标注页面消息可发但不可读。
- 补充推推执行步骤中可用的 Token 用量说明（#11）。
- 安装口径收敛：README 只保留「下载 Release 正式包」与「跟随主干 `github:`」两条路径，
  删掉 npm / 一键脚本 / 本地源码的写法；README 与 README_EN 同步
- 新增 [AGENTS.md](./AGENTS.md)：分层、命令、版本与发版流程、Release Notes 标准、硬性约束
- 仓库不再发布 npm（`package.json` 加 `private: true`），移除 `install.sh`
- README 重排成九段：这是什么 / 快速开始 / 能做什么 / 配置解读 / 架构 / 开发 / 贡献 / 致谢 / 许可
  （原「内置命令」「工具」「智能插话」「发送可靠性」「会话与上下文」「常见问题」各自成节，收进对应主段）
- Release 附带正式包 `dsh-tuitui-bot-<版本>.tgz`，作为推荐安装来源；文件名不带 scope 前缀
  （新增 `scripts/pack.sh` 统一出包，`npm pack` 默认会写成 `eayonlee-` 开头）

## 0.1.30

合并 #11（来自 @wangxiang12379）：修执行进度与 Token 上报。

### 修复

- **runId 复用**：同一条消息的模型调用 / 工具调用 / 完成事件共用一次 `buildContext` 结果（按会话+消息 id 缓存，`agent_end` 时清理），不再每条上报都重建上下文，进度链条不再断
- **首次上报自动补 `message_received`**：消息进入时若没显式调用，第一次上报会补发，保证宿主看到的顺序完整
- **Token 用量**：`assistant/message` 的 `usage` 一路带到 `llm_output`；只有工具调用、没有文本的轮次也会上报用量（原来直接 return 掉了）
- **轮末投递失败不再吞掉任务结束**：`turn/end` 的文本 flush / 错误提示 / 文件交付全部包进 `try/catch/finally`，失败也会在 `finally` 里发 `agent_end`；`reportTarget` 提前快照，避免误用到下一条消息的目标

### 测试

`npx vitest run` 全绿（合并前 860 / 合并后随主线增长），`npm run build` 产物与源码一致。

## 0.1.29

修「工具对模型不可见」（[#14](https://github.com/EayonLee/dsh-tuitui-bot/issues/14)）：7 个工具因缺少 dsh 强制的 `output` 声明，从上线起就没注册成功过。

### 修复

- `tuitui_group` / `tuitui_history` / `tuitui_file` / `tuitui_send` / `tuitui_bot` / `tuitui_teams` / `tuitui_draw` 补上 `output: { schema, render }`（新增 `src/tuitui/tool-output.ts` 统一生成，宽松 object schema + 通用摘要渲染）
- 注册失败从 `warn` 升级为 `error`，启动末尾打一行 `可选能力注册 x/y`，让"少注册几个"在日志里一眼可见

### 为什么会发生

dsh 的 `tools.register()` 校验 `output.render` 必须是函数，缺了直接抛 `must declare output { schema, render, presentationMeta? }`；`runOptional` 把异常兜成了 warn，启动照常，于是「群管理七件事」在 README 上写得明明白白、模型那边却一个都没有。

### 测试

新增 `src/tuitui/tool-registration.test.ts`（5 条）：复刻 dsh 的校验规则跑一遍九个工具的注册函数，断言全部成功、schema 是 object、render 产文本块；全量 869 用例通过。

## 0.1.28

配置页区块顺序整理（[#12](https://github.com/EayonLee/dsh-tuitui-bot/issues/12)）：纯客户端改动，配置键与 wire 协议不变，刷新页面即生效。

### 调整

- **「智能判断」移到「回话方式」正下方**：它是「触发方式 = 智能」的细化配置，原来隔着「表情回执」一整块，改完触发方式还得往下翻才知道有新东西
- **智能判断不再条件渲染，改为常驻置灰**：非智能模式下整块降透明度、控件不可点，标题后跟「仅智能模式生效」。切换触发方式时页面不再上下跳几百像素
- **左侧导航顺序与正文对齐**：原来导航是「智能判断 → 图像 → 表情回执」，正文却是「表情回执 → 智能判断 → … 图像」，点了会跳到不相干的位置；同时补上漏掉的「提示词」入口
- **「单聊/群聊/帖子忙时」收进「忙的时候」小标题**：与「触发方式」（要不要说话）在视觉上分开

### 测试

新增 `src/setup/config-panel-layout.test.ts`（7 条）：区块顺序、导航与正文一致、智能判断常驻置灰、忙时成组；全量 864 用例通过。

## 0.1.27

把发送重试做成正经策略，并加上按会话串行的发送队列。

### 重试

- 次数从 2 次提到 **6 次**（含首发），指数退避 + Full Jitter：`0.5s → 1s → 2s → 4s → 8s` 封顶 15s，实际等待在 [0, 上限] 内随机，避免一堆会话同时重试
- 总预算 **75s**，超了立刻放弃，不让一条消息挂几分钟
- 可重试：`errcode 10503` / `10001` / `10002`、HTTP `429` / `5xx`、网络错误（fetch failed / ECONNRESET / ETIMEDOUT / socket hang up / other side closed）
- 不可重试：参数错（400）、鉴权失败（401/403）等，重试一百次也是同一个结果
- 服务端给了 `Retry-After` 就按它说的等（只受总预算约束）

### 队列

- 同一会话（`c2c:xxx` / `group:xxx` / `post:team:channel`）**串行**发送，不同会话并行
- 每会话最多积压 20 条，超了直接丢弃并记 warn，避免会话卡死时队列无限堆积
- 前一条失败不影响后一条，失败只抛给调用方

### 其它

- 长文本分片之间保留 250ms 间隔
- 新增 `retry-policy.test.ts`（11 条）与 `send-queue.test.ts`（6 条），全量 857 用例通过

## 0.1.26

修「模型答完了、IM 那边一个字没收到」：推推偶尔回 `errcode 10503`，以前直接抛错丢消息。

### 修复

- 发送加了可重试机制：`errcode 10503`、5xx、网络层错误（fetch failed / ECONNRESET / socket hang up）自动重试两次（0.6s、1.8s），参数与权限类错误不重试
- 长文本切分成多条时，片与片之间留 250ms 间隔：同一目标密集发送正是 10503 的常见诱因

### 为什么以前丢消息

线上日志里同一群 40 分钟内出现 42 次 `sendMarkdown failed ... errcode=10503`，每次都只留一条 warn 就把已经生成好的回复扔了，用户侧表现就是“机器人不回话”。

### 测试

- `sender.test.ts` 新增 4 条：10503 两次后成功、重试用尽才失败、非瞬时错误不重试、网络错误重试；5xx 那条既有用例改为断言重试 3 次（837 全过）

## 0.1.25

单聊、群聊忙时的默认策略从「打断 / 排队」改成「合并」。

### 变更

- `concurrency.c2c` 默认 `abort` → `merge`：忙时先攒着，这一轮结束合成一条一起回，不会把上一轮掐成半截
- `concurrency.group` 默认 `queue` → `merge`：群里连发几句不用一条条排队，合成一条答完
- `concurrency.post` 仍是 `queue`（团队帖子一条条来更稳）
- `resolveScopeStrategy` 的兜底同步调整，配置缺字段时行为跟默认值一致

### 测试

- 新增 `src/shared/concurrency-defaults.test.ts`：钉住三项默认值与兜底行为

## 0.1.24

修掉「TEST_MODEL_PATH is not defined」，并补上能让这类事故无法出厂的两道闸。

### 修复

- 设置页引用 `TEST_MODEL_PATH` 却没 `import`（根 `tsconfig.json` 不覆盖 `src/client`，所以 `tsc` 全绿、构建照过，点按钮才炸）
- 客户端扁平配置类型改为 `extends ConfigPatchWire`，不再手抄一份：漏键、抄错键直接编译失败

### 防复发

- `npm run build` 现在先跑客户端类型检查（`tsc -p tsconfig.client.json --noEmit`），构建期就能拦住
- `scripts/ship.sh` 装包前校验 bundle：路径字面量必须在、`TEST_MODEL_PATH` 有定义才能装
- 新增 `src/setup/config-panel-imports.test.ts`：钉住「用了就必须 import」「类型必须继承不手抄」

## 0.1.23

修掉「✗ undefined」，并把测试按钮的状态表达理顺。

### 修复

- 结论那一行读错了字段名（组件要 `text`，状态里给的是 `detail`）→ 页面渲染成 `✗ undefined`；现在统一走 `interpretTestResponse`，保证这句永远是非空人话
- 按钮文字固定为「测试」：失败只把按钮变红，不再写成「失败」——按钮永远可点，原因看下面那行小字
- 成功填绿、失败转红，颜色是唯一的状态信号

### 测试

- 新增 `src/shared/probe-result.test.ts`：6 条，覆盖成功 / 失败 / 404-405（旧进程）/ `error` 字段 / 500 不说成成功 / **detail 永不为 undefined**

## 0.1.22

连接测试不会再卡在「测试中」。

### 修复

- 测试请求加了 25 秒超时 + `finally` 收口：无论是成功、失败、抛错、超时，按钮都会回到可点状态
- 路由不存在（服务端插件还是旧进程）时直接说人话：`这个接口不存在——服务端插件还是旧进程，先跑 ~/bin/dsh-restart`，不再只给一个裸状态码

### 测试

- 新增 `src/setup/test-model-live.test.ts`：真 HTTP 端到端（浏览器 → 插件路由 → 假网关），5 条用例覆盖成功 / 401 鉴权失败 / 留空用已存密钥 / 网关无 /models / 死端口，并断言探活只会打 `GET /models`

## 0.1.21

连接测试按钮重做，历史注入默认改成省 token 的那一档。

### 变更

- **连接测试按钮挪到密钥框右侧**，一个按钮三态：绿色描边「测试」→ 测试中… → 填绿「成功」/ 转红「失败」，结论一行小字挂在下面，不再单开一行
- 点测试前先校验：地址、模型ID 没填全就直接提示「先填上再测试」；密钥是例外，留空表示用已保存的那把
- 探活只用 `GET /models`：只验证地址通不通、密钥对不对，不跑图像理解、不生成图片、不烧额度
- `historyMode` 默认改为 `delta`（只补没给模型看过的新消息）：同一批内容不重复灌，省 token；缓冲仍滚动保留，旧内容由会话自身记忆兜着，不丢上下文

## 0.1.20

群聊历史改回「最近 N 条」的直觉，另给一个省 token 的档。

### 新增

- 配置项 `historyMode`（设置页「怎么带历史」下拉）：
  - `window`（默认）：每次被叫到就带最近 N 条，跟别的机器人一样直观、好预期
  - `delta`：只补「还没给模型看过」的新消息，同一批内容不重复灌，省 token

### 说明

- 缓冲不再回复后清空，所以 `historyLimit=50` 现在真的能带满 50 条（之前线上实测只有 0~19 条）

## 0.1.19

表情回执改成**下拉选**，不再让人手打。

### 变更

- 设置页「在算 / 完成 / 出错」三项由输入框改成下拉框，选项是实测可用的内置表情名 + 「不挂」
- 推推只认内置表情名（微笑 / 强 / 奶茶…），QQ 那套名字（难过 / 偷笑）在这里全非法；手打等于让人踩雷，填错只会得到一句「不合法的emoji表情」
- 存量配置里的自定义值会补一项「xxx（自定义）」，不会显示成空白

## 0.1.18

表情回执一直是坏的——不是没权限，是**推推不认 unicode emoji**。同时把「50 条上下文」这件事做对了。

### 修复

- **表情回执可用**：`emoji_reaction.emoji` 只认推推内置表情名（`微笑` / `强` / `OK` / `奶茶`…）。之前默认值写的是 `👀` / `✅` / `😵`，服务端一律回 `不合法的emoji表情`；而失败只在 debug 级记，info 日志里查不到，于是表现成「设了也没反应」。
  - 默认值换成实测可用的名字：在算=`微笑`、完成=`OK`、出错=`委屈`
  - 老配置里的 unicode 自动翻译（`👀`→微笑、`✅`→OK、`👍`→强、`🎉`→庆祝…），只映射验证过的名字
  - 认不出来的直接跳过并 warn，不再发必然失败的请求
  - 失败日志从 debug 提到 warn，并带上实际发出的表情名
- **群聊上下文不再「回复后清空」**：以前每次回完就把整个缓冲清掉，下一轮 @ 只能看到「上次回复之后」的那几条（线上实测 0~19 条，永远凑不满设置里的 50）。改成水位线：缓冲滚动保留最近 N 条，注入时只补「还没给模型看过」的新消息——既不重复，也能真的看到一整窗。

### 变更

- 设置页「图像理解与生成」：地址 / 模型ID / 密钥改成宽输入框（原来挤在 76px 里）
- 去掉「尺寸」配置项：出图尺寸按模型默认走，不再让人填
- 文案统一 `模型 id` → `模型ID`

## 0.1.17

图像能力从"只认 dsh 的 llm"改成"可以直接用你自己的 OpenAI 兼容网关"。

### 新增

- **图像理解 / 生成各配一套端点**（`vision.*`、`imageGeneration.*`）：地址 + 密钥 + 模型 id，互不影响
- **`tuitui_draw` 工具**：用配置的文生图模型出图，落盘后直接发到当前会话，返回本地路径
- **`/tuitui/im-tuitui/test-model` 路由**：设置页「测试连接」，只探 `/models`，不生成内容、不花钱
- 设置页新增「图像理解与生成」：两段配置、连接测试按钮、"已设置/未设置"标记

### 变更

- `tuitui_describe_image` 配了 `vision.baseUrl` + `vision.apiKey` 就走直连，否则退回原来的 dsh llm 路径（老配置不受影响）
- 设置页「智能判断」补上"它到底在判断什么"的说明：要不要接、怎么接、什么时候闭嘴；并注明 @ 与引用回复不走判定

### 安全

- 端点密钥只写不读：配置接口永远不下发明文，页面只显示"已设置"；留空保存 = 不改动已存密钥

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
- **插件能力全量接入（工具化）**：新增 `tuitui_group`（群管理 7 个动作）、`tuitui_history`（拉聊天记录）、`tuitui_file`（上传/查询/文件空间）、`tuitui_send`（链接/卡片/富文本/撤回/强通知/电话报警）、`tuitui_bot`（身份/改名/头像/快捷指令/工作台菜单）。写操作一律要 `confirm=true`，读操作不设闸
- **群事件进上下文**：`group_create` / `group_invite` / `group_kick` 写一条系统消息进判定历史，机器人知道自己怎么进的群
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

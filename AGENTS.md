# AGENTS.md

给协作者和自动化 agent 的作业手册。**动手之前先读完这一页**，能省掉一轮返工。

用户文档看 [README.md](./README.md)，贡献流程看 [CONTRIBUTING.md](./CONTRIBUTING.md)，
本文件只讲「怎么改、怎么发、什么不能碰」。

## 项目是什么

360 推推 IM 的 dsh 渠道插件（`@eayonlee/dsh-tuitui-bot`）：把推推的私聊/群聊/团队频道
接进 dsh agent，支持流式回复、卡片、图片、语音、表情回执、群管理与工具调用。

## 代码分层（改之前先认位置）

依赖方向是单向的，反了就是错：

```
src/tuitui/     ← 唯一允许 import @qihoo/tuitui-bot-sdk 的层
src/gateway/    ← 中间件链（访问控制、并发、去重、限流…）
src/transport/  ← 事件归一化、发送
src/features/   ← 会话、历史、群管理、工具
src/shared/     ← 协议与工具函数（被 client 和 server 共用）
src/client/     ← 设置页 UI；禁止 import 任何服务端模块
```

`client → shared`、`transport → features` 是允许的；`shared` 不能反向依赖 `tuitui`。

## 常用命令

```bash
npm ci                # 依赖
npm run typecheck     # 服务端 + 客户端双端类型检查（提交前必跑）
npm test              # 全量单测
npm run build         # 构建 lib/（会被提交进仓库）
npm run verify -- --profile <name>   # 启动接线自检（凭据：env/.env → --profile → 自动扫 ~/.dsh/profiles/*）
npm run smoke:live    # 真实凭据冒烟（会真的发消息）
node scripts/verify-tools.mjs   # 校验 9 个工具是否真的注册进 dsh
```

## 版本与发布：不要每改必发版

这是本仓库最容易搞错的地方，写死在这里：

1. **日常改动不碰 `package.json` 的 `version`。** 版本号是发版动作，不是提交动作。
2. **日常改动只写 `CHANGELOG.md` / `CHANGELOG_EN.md` 顶部的 `## 未发布（Unreleased）`**，
   维护者发版时才把它改成版本号 + 日期，并同步 `package.json`。
3. **发 npm 是发版动作，不是提交动作。** 只有维护者在发版时、按下面的流程才 `npm publish`；
   平时任何 PR 都不要动 `package.json` 的 `publishConfig`，也不要往 npm 发任何东西。
4. 一个 PR 只做一件事；顺手改版本号、改别人 CHANGELOG 条目，都会被退。

### 维护者发版流程

在 `main` 干净且 CI 绿的前提下：

```bash
# 1. 定版本号（语义化：修复 PATCH / 兼容新增 MINOR / 破坏性 MAJOR）
#    0.x 阶段 MINOR 可以装新功能，破坏性变更在 Notes 里单独标出

# 2. 终结 Unreleased
#    - CHANGELOG.md / CHANGELOG_EN.md：'## 未发布（Unreleased）' → '## 0.1.30 (2026-11-06)'
#    - package.json：version 改成新号
#    - npm run build，把 lib/ 产物一起提交

# 3. 合并到 main

# 4. 打 tag（只在 main 上打，已发布的 tag 永不移动）
git tag v0.1.30 && git push origin v0.1.30

# 5. 建 Release 并上传正式包
./scripts/pack.sh /tmp/rel     # 产出带版本号的包 + 稳定别名 dsh-tuitui-bot.tgz
gh release create v0.1.30 --target main --title "v0.1.30" --generate-notes
# 两个 asset 都要传：缺稳定别名，README 的 /releases/latest/download/ 直链就失效
gh release upload v0.1.30 /tmp/rel/dsh-tuitui-bot-0.1.30.tgz /tmp/rel/dsh-tuitui-bot.tgz

# 6. 发布到 npm（与 Release 同一个版本号，两条安装通道要同时发）
npm whoami --registry=https://registry.npmjs.org   # 必须输出 eayonlee
npm publish                                        # publishConfig 已锁官方源 + access public
npm view @eayonlee/dsh-tuitui-bot version           # 回读校验
```

npm 与 Release 必须同版本、同内容：`scripts/pack.sh` 打出的 tarball 和 `npm publish` 的产物
走同一份 `files` 白名单，谁先发都不会出现「npm 上是新的、Release 里没有 asset」这种撕裂。

**第 4～6 步是同一次发版动作，要连着做完。** 打完 tag、建好 Release 就顺手 `npm publish`，
不用再单独问一次；只发了 GitHub、忘了 npm，按「这次发版没做完」处理。反过来也一样：
先发的 npm 也必须补上对应的 tag 与 Release。

### Release Notes 标准

标题固定 `vX.Y.Z`。正文按这个骨架写，不要自由发挥：

```markdown
一句话说清这个版本的主线。

## 新增
- 做了什么（#issue/PR）

## 修复
- 修了什么现象、根因一句话（#issue/PR）

## 破坏性变更
- 配置键 / 行为变了什么，用户要怎么改（没有就删掉这一节）

## 升级注意
- 需要重启进程 / 刷新页面 / 重新填配置（没有就删掉这一节）
```

硬要求：

- 每条都能落到具体的 PR 或 issue 号
- 写「用户视角的现象」，不写「调整了内部实现」
- 禁止「若干优化」「体验提升」这类没有信息量的句子
- 装包方式变化必须写进「升级注意」

## 安装口径（文档必须一致）

对外**只有两条路径**，任何文档都不要写第三种：

1. **npm**：`dsh plugin --profile <name> add @eayonlee/dsh-tuitui-bot`（不写版本号 = `latest`）
2. **Release 直链**：
   `dsh plugin --profile <name> add https://github.com/EayonLee/dsh-tuitui-bot/releases/latest/download/dsh-tuitui-bot.tgz`

升级、卸载都用这两条（卸载按包名 `remove @eayonlee/dsh-tuitui-bot`）。

**升级要带 `@latest`。** profile 里已钉住具体版本号时，不带版本号的 `add` 等于「装回原版本」，
不是升级；只有首次安装才可以省。

**文档里不要出现具体版本号。** 用户会照抄命令，写死 `@0.1.x` 这种号就是让人装成老版本。
- npm 侧靠「不写版本号」拿 latest；
- Release 侧靠**稳定 asset 名** `dsh-tuitui-bot.tgz`：每次发版都覆盖上传这一个文件，
  `/releases/latest/download/dsh-tuitui-bot.tgz` 因此永远指向最新版；
- 要固定版本时才写具体号，且一律用占位符 `<版本>` 说明「替换成你要的号」。

npm 与 Release 同版本、同产物（同一份 `files` 白名单）。**不写**从源码目录安装、**不写**
`github:EayonLee/dsh-tuitui-bot` 跟主干、不写一键脚本——这三样都已经被明确排除。
本地开发的 `link:$PWD` 只在 CONTRIBUTING 里给贡献者看，不算用户安装方式。

## 硬性约束

- **凭据**：AppID / AppSecret / API Key 一律不进仓库、不进日志、不回显。配置从 profile 的
  `cordis.patch.yml` 读，脚本里用 `process.env` 或配置文件读。
- **重启**：统一走 `sudo systemctl restart dsh-web`。不要写自己的重启脚本，也不要在仓库里
  放重启工具——一台机器一套起停方式，脚本多了必然打架。构建产物装好即可，**重启由人执行**：
  agent 自己跑 `systemctl restart dsh-web` 会把自己所在的会话进程一起杀掉（2026-11-05 连挂两次）。
- **破坏性操作**：删文件、改仓库设置、动分支保护、发布，都必须有人明确说「执行」。
- **工具注册**：dsh 要求 `output: { schema, render }` 缺一不可，漏了会**静默**注册失败
  （见 issue #14）。新增工具后跑 `node scripts/verify-tools.mjs`。
- **提交规范**：Conventional Commits，见 CONTRIBUTING §5。

## 文档对齐

改行为时同步改这几处，否则算没做完：

| 改了什么 | 要同步 |
| --- | --- |
| 用户可见行为 / 配置项 | `README.md` + `README_EN.md` |
| 工具、内部约定、发版流程 | 本文件 |
| 贡献流程、提交规范 | `CONTRIBUTING.md` |
| 任何用户能感知的改动 | `CHANGELOG.md` + `CHANGELOG_EN.md` 的 Unreleased |
| 架构分层变化 | `README.md` 的「架构」节 |

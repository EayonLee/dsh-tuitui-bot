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
npm run verify        # 启动接线自检：不用 dsh CLI / LLM Key
npm run smoke:live    # 真实凭据冒烟（会真的发消息）
node scripts/verify-tools.mjs   # 校验 9 个工具是否真的注册进 dsh
```

## 版本与发布：不要每改必发版

这是本仓库最容易搞错的地方，写死在这里：

1. **日常改动不碰 `package.json` 的 `version`。** 版本号是发版动作，不是提交动作。
2. **日常改动只写 `CHANGELOG.md` / `CHANGELOG_EN.md` 顶部的 `## 未发布（Unreleased）`**，
   维护者发版时才把它改成版本号 + 日期，并同步 `package.json`。
3. **不发 npm。** `package.json` 里 `private: true`，任何 `npm publish` 都是错的。
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
./scripts/pack.sh /tmp/rel
gh release create v0.1.30 --target main --title "v0.1.30" --generate-notes
gh release upload v0.1.30 /tmp/rel/dsh-tuitui-bot-0.1.30.tgz
```

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

对外只有两条路径，任何文档都不要写第三种：

1. **正式包**：从 [Releases](https://github.com/EayonLee/dsh-tuitui-bot/releases/latest) 下载
   `dsh-tuitui-bot-<版本>.tgz`，然后 `dsh plugin --profile <name> add ./<tarball>`
2. **跟随主干**：`dsh plugin --profile <name> add github:EayonLee/dsh-tuitui-bot`

不写 npm、不写本地源码目录、不写一键脚本。

## 硬性约束

- **凭据**：AppID / AppSecret / API Key 一律不进仓库、不进日志、不回显。配置从 profile 的
  `cordis.patch.yml` 读，脚本里用 `process.env` 或配置文件读。
- **重启**：不要自己重启 dsh 进程（`~/bin/dsh-restart` 由人执行）。构建产物装好即可，
  告知用户重启。
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

# 贡献指南

感谢你愿意改进 `@eayonlee/dsh-tuitui-bot`。这份文档说明本地怎么跑、代码怎么分层、提交与 PR 的规矩，
照着做能省掉来回沟通的时间。

English speakers: contributions are welcome — feel free to open issues/PRs in English, the rules below still apply.

## 1. 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 20.3 | 宿主 dsh 要求 ≥ 22，建议直接用 22/24 |
| npm | 随 Node 自带 | 仓库用 `package-lock.json`，请勿换成 pnpm/yarn 生成新的锁文件 |
| dsh | 0.2.1-rc.5+ | 本地联调与端内面板验证需要 |

## 2. 本地跑起来

```bash
git clone https://github.com/EayonLee/dsh-tuitui-bot.git
cd dsh-tuitui-bot
npm ci

npm run typecheck   # 服务端 + 客户端两套 tsconfig
npm test            # vitest 全量
npm run build       # 产出 lib/index.js（服务端）与 lib/client.js（浏览器端）
```

装进本地 profile 联调（改完源码执行 `npm run build` 后热加载）：

```bash
dsh plugin --profile tuitui add link:$PWD
cp .env.example .env      # 填 TUITUI_BOT_APPID / TUITUI_BOT_SECRET
dsh --profile tuitui
```

真实凭据冒烟（会真的往推推发消息，只在测试群里跑）：

```bash
node scripts/smoke-live.mjs --send group:<群 id>
node scripts/verify-bootstrap.mjs     # 或 npm run verify
```

## 3. 代码分层（改之前先认位置）

| 目录 | 职责 | 硬约束 |
| --- | --- | --- |
| `src/tuitui/` | 推推 SDK 适配（client / inbound / sender / agent-reporter / shortcut） | **全插件唯一**允许 `import '@qihoo/tuitui-bot-sdk'` 的地方 |
| `src/gateway/` | 中间件内核与编排（顺序是行为契约） | 新增中间件必须写进 `middleware-setup.ts` 并补测试 |
| `src/session/` `src/host/` `src/model/` | 会话生命周期、宿主 adapter、模型/preset 偏好 | 不直接碰推推 SDK |
| `src/transport/` | 入站组装、切分、流式、出站缓冲、交付物 | 只依赖 `types.ts` 抽象，不认平台原始 JSON |
| `src/features/` | 审批 / 问答 / 历史 / 追问窗口等横切能力 | 不发消息，只产出结构化结果 |
| `src/commands/` | 斜杠命令 | 命令要有单测 |
| `src/media/` `src/setup/` `src/client/` | 富媒体工具、端内绑定、浏览器端面板 | 客户端代码不 import 服务端模块 |

跨层依赖只能自上而下（`client → shared`、`transport → features`），反向依赖会被评审打回。

## 4. 改动要求

- **必须带测试**：新增/修改中间件、发送路径、命令、解析逻辑时，补对应 `*.test.ts`；
  纯文档、注释、样式改动除外。
- **不新增运行时依赖**，除非有明确理由并在 PR 里说明（当前运行时依赖只有 SDK 与 `yaml`）。
- **错误必须兜住**：所有网络/IO 调用要有 `try/catch` 与可读日志，日志前缀统一 `im-tuitui:`。
- **面向用户的中文文案**要短、说结论；技术注释写清「为什么」而不是复述代码。
- **不提交凭据**：`appSecret`、API Key、真实群 id 一律不进仓库（`.env` 已在 `.gitignore`）。

## 5. 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat(transport): 支持长消息按代码块切分
fix(tuitui): recall 失败时不再抛出到上层
docs: 补充 CONTRIBUTING
refactor(session): 合并两次 session 查询
test(gateway): 补 smart 触发的边界用例
chore: 脚本加可执行位
```

- 一个提交只做一件事；格式化与功能改动分开。
- 提交信息用中文或英文均可，但与同仓库已有风格保持一致（当前以中文为主）。
- 破坏性变更写成 `feat!:` 或 `BREAKING CHANGE:`，并在 PR 说明里写迁移方式。

## 6. PR 流程

1. Fork 后从 `main` 切分支：`feat/xxx`、`fix/xxx`。
2. 按 [PR 模板](./.github/PULL_REQUEST_TEMPLATE.md) 填写：改动说明、影响面、自查清单。
3. 本地必须通过：`npm run typecheck`、`npm test`、`npm run build`。
4. 涉及推推收发行为的改动，附冒烟结果（`scripts/smoke-live.mjs` 输出）或说明无法验证的原因。
5. 改动配置项时，同步更新：`src/config.ts` 的 Schema、`cordis.patch.yml`（若需暴露）、
   `README.md` 与 `README_EN.md` 的配置表、`src/setup/bind-routes.ts` 的可编辑键白名单。
6. 提交后保持分支可 rebase，合并方式由维护者决定（默认 squash）。

## 7. 提 issue 之前

- 先搜已有 issue / Discussions，避免重复。
- Bug 用 [Bug 报告](https://github.com/EayonLee/dsh-tuitui-bot/issues/new?template=bug_report.yml)，
  附 dsh 版本、插件版本、会话形态（单聊/群聊/帖子）、脱敏后的 `im-tuitui` 日志。
- 功能建议用 [功能建议](https://github.com/EayonLee/dsh-tuitui-bot/issues/new?template=feature_request.yml)，
  说明推推侧可复用的原生能力（SDK 方法名）比只描述期望更有效。

## 8. 发布（维护者）

1. 更新 `CHANGELOG.md` / `CHANGELOG_EN.md`，语义化版本号写进 `package.json`。
2. `npm run build`，确认 `lib/` 产物提交进仓库（支持 `github:` 直接安装）。
3. `npm pack --dry-run` 检查包内容，`npm publish`。
4. 打 tag：`git tag v0.x.y && git push --tags`。

## 9. 行为准则

参与本项目即表示同意遵守 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。安全问题请按
[SECURITY.md](./SECURITY.md) 的流程私下报告。

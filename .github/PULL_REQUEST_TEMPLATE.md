## 改动说明

<!-- 一句话说清这个 PR 解决什么；关联 issue 用 "Closes #123" -->

## 改动类型

- [ ] 修复 bug
- [ ] 新功能 / 新能力
- [ ] 重构（行为不变）
- [ ] 文档 / 工程（CI、构建、发布）
- [ ] 推推协议适配（SDK / 事件 / 卡片）

## 影响面

<!-- 涉及哪些目录：src/tuitui、src/gateway、src/transport、src/session … 是否触碰中间件顺序 -->

## 自查清单

- [ ] `npm run typecheck` 通过
- [ ] `npm test` 全绿
- [ ] `npm run build` 产出 `lib/index.js` + `lib/client.js`
- [ ] 若改了推推收发：`node scripts/smoke-live.mjs --send group:<id>` 通过（或说明无法验证的原因）
- [ ] 若改了配置项：同步更新 `src/config.ts`、`cordis.patch.yml`、README（中/英）
- [ ] 未提交明文凭据（appId / appSecret / API Key）

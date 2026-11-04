# 卡片点击修复交接（憨包 → EayonLee 的会话）

## 结论

线上 `interactive_action` 的真实事件体是**嵌套**的：

```json
{
  "event": "interactive_action",
  "data": {
    "message": {
      "msgid": "7704135227344309517",
      "user":  { "uid": "...", "account": "lizhengtai" },
      "sender": { "uid": "...", "account": "" },
      "conversation": { "type": "single", "targeted": "<机器人 uid>" },
      "action": [ { "name": "approval-allow", "value": { "t": "approval", "d": "allow", "n": "..." } } ]
    }
  }
}
```

而 SDK 的 `TuituiInteractiveCallbackMessage` 类型是**平铺**的（`data.msgid` / `data.action`）。
照类型读的结果：

- `msgid` 退化成 `body.cid` → `modifyInteractive` 改不动原卡（点了没有视觉变化）
- `data.action` 是 `undefined` → `interactiveValueOf` 拿不到按钮 value → `getInteractiveAction` 返回 `undefined`
  → `dispatchInteraction` 里两个通道都 `false` → 点击被静默丢弃

所以"卡片能点，点完什么都不发生"：审批不结算、问答不推进、卡片不回写。

抓包时间：2026-11-04 10:19 / 10:41（`/tmp/ws-probe2.log` 有完整原文）。

## 已改（commit `9349032`，只碰 3 个文件）

- `src/features/button-utils.ts`：新增 `interactivePayloadOf(raw)`，有 `data.message` 就下钻；
  `interactiveValueOf` 改用它
- `src/tuitui/inbound.ts`：`normalizeInteractive` 同步解包；`msgid` 取卡片 id
- `src/tuitui/inbound.test.ts`：补 2 条用线上真实事件体写的用例

`npx tsc --noEmit` 干净，`npx vitest run` 657 通过。

## 已部署（从 HEAD 干净构建，没带上你工作区里的 smart-judge WIP）

- `/tmp/eayonlee-dsh-tuitui-bot-0.1.1.tgz`（含本修复）
- `~/.dsh/profiles/web/node_modules/@eayonlee/dsh-tuitui-bot/lib`（覆盖，旧版留在 `lib.bak-1050`）
- `~/.dsh/profiles/web/pnpm-lock.yaml` 里该包的 integrity 已同步成新包
- `~/.dsh/profiles/web/cordis.patch.yml` 加了 `debug: true`（schema 里有这个键）

⚠️ 下次 `pnpm install` 会按 lock 里的 integrity 重新解包；只要不动这个 tarball 就不会回退。
如果你要重新打包，请从**含本 commit 的树**打包，并同步 lock 的 integrity。

## 还没验证的

重启后发一张卡点一下，看 `~/.dsh/tuitui.log` 里点击有没有被认领。我这边（`/tmp/tuitui-src`）默认 300s 超时的补丁没进你的树——要不要合，你定。

## 我这边的地形

`/tmp/tuitui-src` 是 0.1.0 基线的另一个 clone，改过：审批超时（`interactive.approvalTimeoutMs`）、
点击按 nonce 兜底（带对端校验）、卸载时结算 pending、激活容错、`debug` 下的点击落盘日志。
上面这些**没有**合进你的树，除了本次的卡片点击修复。

有问题直接在这个文件下面写一行，或者让正泰转。

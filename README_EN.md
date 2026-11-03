<div align="center">

<img src="./assets/icons/tuitui.svg" width="96" alt="Tuitui Bot" />

**A 360 Tuitui (推推) bot plugin for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh)**

Chat with DeepSeek Harness in Tuitui **direct messages, group chats and team channel posts**.

[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.2.1--rc.5-8A2BE2)](https://github.com/deepseek-ai/deepseek-harness)

**[简体中文](./README.md) | English**

</div>

---

## What it is

Turns a Tuitui bot into a **channel frontend** for dsh:
Tuitui message → normalized → middleware chain → dsh Agent; and dsh text/tools/approval/questions/deliverables
→ Tuitui messages, native interactive cards and in-place streaming edits.

The layout mirrors Tencent's official `@tencent-connect/dsh-qqbot` plugin one-to-one — same directory
layering, same middleware order, same session/command/approval semantics — with the QQ Bot transport
swapped for the Tuitui SDK ([`@qihoo/tuitui-bot-sdk`](https://www.npmjs.com/package/@qihoo/tuitui-bot-sdk)).

### Features

| Capability | Details |
| --- | --- |
| 💬 Three chat scopes | Direct chat, group chat (@-mention gated), team channel posts (threaded replies) |
| ⚡ Streaming | First message returns `msgid`, then `modifyText(without_push)` refreshes in place |
| 🃏 Native cards | Approval / questions as Tuitui interactive cards, updated via `modifyInteractive` |
| 🖼️ Rich media | Images / files / voice / video are fetched into a local media dir for the agent |
| 📎 File delivery | `tuitui_send_file` tool plus automatic `present` deliverable delivery |
| 🧭 Context awareness | Group history buffer, quoted-message parsing, sender dept path, mention cleaning |
| 🧩 Slash commands | `/new` `/compact` `/model` `/preset` `/status` `/stop` …, synced as Tuitui quick commands |
| 🧠 Native step reporting | Model/tool steps reported through `client.agent` for the Tuitui client UI |
| 🔐 Access control | open / allowlist / disabled per scope (direct, group, post) |
| 🛠️ In-app binding | Settings page → `property.info()` verification → credentials persisted to the profile |

## Quick start

```bash
# 1. install the bundle into a profile
dsh plugin --profile tuitui add @qihoo/dsh-tuitui-bot
# (or from a local checkout / tarball)
dsh plugin --profile tuitui add /path/to/dsh-tuitui-bot

# 2. configure credentials
export TUITUI_BOT_APPID="your-app-id"
export TUITUI_BOT_SECRET="your-app-secret"
export DEEPSEEK_API_KEY="your-deepseek-key"

# 3. run
dsh --profile tuitui
```

Alternatively leave the env vars unset and fill **Settings → Tuitui Bot** in the GUI; the plugin verifies the
credentials with `property.info()` and writes them into the profile's `cordis.patch.yml`.

Then talk to the bot: DM it, @-mention it in a group, or post in a team channel and @-mention it.

## Configuration

All options live in [`src/config.ts`](./src/config.ts). In a profile, override them in `cordis.patch.yml`
(a patch replaces the whole `config` object, so restate every key you want to keep).

### Core

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `appId` | string | `''` | Bot AppID (or `TUITUI_BOT_APPID`) |
| `appSecret` | string | `''` | Bot AppSecret (or `TUITUI_BOT_SECRET`) |
| `provider` / `model` | string | - | Override the LLM route; empty inherits the host default |
| `preset` | string | - | Agent preset id (applies to new sessions) |
| `cwd` | string | `~/.dsh-tuitui/workspace` | Agent working directory |
| `requireMention` | boolean | `true` | Require @bot in groups |
| `requireMentionInPost` | boolean | `true` | Require @bot in team posts |
| `groupPrompt` / `directPrompt` / `postPrompt` | string | - | Per-scope extra system prompt |
| `textChunkLimit` | number | `4000` | Max characters per message |
| `debug` | boolean | `false` | Verbose logs (includes raw event bodies) |

### Sessions & concurrency

| Key | Default | Description |
| --- | --- | --- |
| `streaming` | `true` | Streaming output (in-place edits) |
| `streamIntervalMs` | `600` | Streaming refresh throttle |
| `sessionIdleTimeout` | `1800000` | Idle session eviction (ms) |
| `maxQueue` | `20` | Per-peer queue limit |
| `processingTimeoutMs` | `1800000` | Turn timeout (ms) |
| `askTimeoutMs` | `300000` | Pending question timeout (ms) |
| `historyLimit` | `10` | Group/post history buffer size |
| `showToolResults` | `false` | Show successful tool output (errors always shown) |

### Access control

`access.c2cMode` / `access.groupMode` / `access.postMode` accept `open` | `allowlist` | `disabled`;
the matching `c2cAllow` / `groupAllow` / `postAllow` arrays take accounts or UIDs, group ids, and
channel/team ids. An empty allowlist in `allowlist` mode **denies everyone** (fail-closed).

### Media, vision, attachments

`media.enabled` / `media.maxMB` / `media.ttlHours`, `vision.enabled` / `vision.provider` /
`vision.model`, `sendFile.restrictPaths` / `sendFile.extraRoots` / `sendFile.sendPresentedFiles`.

### Tuitui-native switches

`interactive.enabled` (cards for approval/questions), `interactive.headBgColor` / `headTextColor`,
`agentSteps.enabled` / `includeToolPayload` / `maxResultChars`, and `apiBaseUrl` / `websocketBaseUrl`
for private deployments (also `TUITUI_BOT_API_BASE` / `TUITUI_BOT_WS_BASE`).

## Commands

`/new` (`/reset`, `/clear`), `/compact`, `/model`, `/preset`, `/status`, `/stop`, `/bot-ping`,
`/bot-version`, `/bot-help`, `/auth`.

## Tools

| Tool | Description |
| --- | --- |
| `tuitui_send_file` | Send a local file, URL or in-memory payload to the current chat (path allowlist enforced) |
| `tuitui_describe_image` | Vision understanding (requires `vision.enabled`; uses dsh llm + attachments) |

## Architecture

```
Tuitui events (WebSocket)
   │  src/tuitui/inbound.ts      normalize single_chat / group_chat / teams_post_create / interactive_action
   ▼
Middleware onion (src/gateway/middleware/)
   errorHandler → messageFilter → accessPolicy → historyBuffer → mentionGate →
   contentSanitizer → rateLimiter → slashCommand → questionAnswer →
   concurrencyGuard → typingIndicator → quoteRef → attachmentProcessor → envelopeFormatter
   ▼
src/transport/inbound.ts   5-layer assembly → agent.followup
   ▼
dsh Agent (session/**, host/**, model/**)
   ▼
dsh events (session/event, agent/assistant-stream)
   │  src/transport/{outbound,streaming-writer,outbound-buffer,tool-presenter,deliverables}.ts
   ▼
src/tuitui/sender.ts   im.sendText / modifyText / sendInteractive / modifyInteractive / sendFile / recall / emojiReaction
                       teams.sendPost / editPost / sendFile / emojiReaction
```

**Only `src/tuitui/` imports the Tuitui SDK.** Everything else depends on the `TuituiSender` abstraction in
[`src/types.ts`](./src/types.ts), which keeps the transport replaceable and testable.

## Development

```bash
npm install
npm run typecheck        # tsc --noEmit
npm test                 # vitest
npm run build            # tsc → lib/ + tsdown → lib/client.js

# live smoke test against the real bot API
TUITUI_BOT_APPID=xxx TUITUI_BOT_SECRET=yyy node scripts/smoke-live.mjs
node scripts/smoke-live.mjs --send group:<groupId>   # also exercises send / edit / recall

# bootstrap wiring self-check (no dsh CLI, no LLM key): client, sender, middleware
# chain, tool registration, WS subscription, property.info, shortcuts, disposal
TUITUI_BOT_APPID=xxx TUITUI_BOT_SECRET=yyy node scripts/verify-bootstrap.mjs
```

Local source debugging without installing the package:

```bash
dsh web --patch /path/to/dsh-tuitui-bot/cordis.dev.yml
```

## QQ plugin mapping

| QQ plugin | Tuitui plugin |
| --- | --- |
| C2C / group | direct / group / team post (`post` scope is new) |
| `openid` identifiers | `account` / `uid` / `group_id` |
| Passive reply window | unlimited; `referenceMessageId` quoting |
| `openStream` | `modifyText` in-place edits |
| InlineKeyboard + interaction | interactive cards + `interactive_action` |
| Guild channels | team channel posts |
| QR-code binding | credential form + `property.info()` verification |

## License

[MIT](./LICENSE)

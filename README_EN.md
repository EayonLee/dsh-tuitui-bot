<div align="center">

<img src="./assets/icons/tuitui.jpg" width="96" alt="Tuitui Bot" />

**A 360 Tuitui (推推) bot plugin for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh)**

Chat with DeepSeek Harness in Tuitui **direct messages, group chats and team channel posts**.

[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.2.1--rc.5-8A2BE2)](https://github.com/deepseek-ai/deepseek-harness)
[![node](https://img.shields.io/badge/node-%3E%3D20.3-339933)](https://nodejs.org)

**[简体中文](./README.md) | English**

</div>

---

## What it is

Turns a Tuitui bot into a **channel frontend** for dsh:
Tuitui message → normalized → middleware chain → dsh Agent; and dsh text/tools/approval/questions/deliverables
→ Tuitui messages, native interactive cards and in-place streaming edits.

Transport is the official Tuitui SDK ([`@qihoo/tuitui-bot-sdk`](https://www.npmjs.com/package/@qihoo/tuitui-bot-sdk));
on top sits a self-contained onion middleware chain: **access control → history buffer → trigger gate →
sanitize → rate limit → slash commands → concurrency → typing → quote ref → attachments → envelope**.
The order is the behaviour contract.

### Features

| Capability | Details |
| --- | --- |
| 💬 Three chat scopes | Direct chat, group chat, team channel posts (threaded replies), each with its own context |
| ⚡ Streaming | First message returns `msgid`, then `modifyText` refreshes in place; falls back to appended deltas |
| 🃏 Native cards | Approval / questions as Tuitui interactive cards, updated via `modifyInteractive` |
| 🖼️ Rich media | Images / files / voice / video are fetched into a local media dir for the agent |
| 📎 File delivery | `tuitui_send_file` tool plus automatic `present` deliverable delivery |
| 🧭 Context awareness | Group history buffer, quoted-message parsing, sender dept path, mention cleaning |
| 🧩 Slash commands | `/new` `/compact` `/model` `/preset` `/status` `/stop` …, synced as Tuitui quick commands |
| 🧠 Native step reporting | Model/tool steps reported through `client.agent` for the Tuitui client UI |
| 🔐 Four access modes | open / allowlist / blocklist / disabled per scope, allow/deny lists entered as chips |
| 🗣️ Smart interjection | In `smart` mode a model reads the group context and decides whether to speak up — **the judging prompt is fully editable in Settings** |
| 🛠️ In-app settings | Credential binding plus every common option, saved to the profile and hot-reloaded; lists are chips, workspace is a dropdown |

## Quick start

```bash
# 1. install the bundle into a profile
sh install.sh                                              # one-shot script (npm, falls back to GitHub)
dsh plugin --profile tuitui add @eayonlee/dsh-tuitui-bot     # npm (recommended)
dsh plugin --profile tuitui add github:EayonLee/dsh-tuitui-bot   # straight from GitHub (lib/ is committed)
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

Group trigger modes (`mentionPolicy`):

- `require` (default): only @-mentions count.
- `smart`: a model reads recent context and decides whether to join in — it stays quiet when others
  talk to each other, and speaks up when addressed or when it clearly matters. The judging prompt is editable.
- `always`: answer every group message (dedicated rooms only).

## Configuration

All options live in [`src/config.ts`](./src/config.ts). In a profile, override them in `cordis.patch.yml`
(a patch replaces the whole `config` object, so restate every key you want to keep).

### Settings page (recommended)

dsh Settings → **Tuitui Bot** edits everything common in place; saving writes the profile and hot-reloads:

- **Scope**: per-scope access mode; allow/deny lists are **chip inputs** — Enter or a comma commits a chip,
  `Backspace` removes the last one, `×` removes one. No format to memorise.
- **When to reply**: the three trigger modes; in `smart` you also get bot aliases, the follow-up window,
  and the **judging prompt editor** (multi-line, monospace, one-click restore to factory default).
- **Context & sessions**: group history size and idle eviction, with unit suffixes and plain-language help.
- **Workspace**: a dropdown of real directories (default workspace, projects under `~/workspace`, current value).
- **Tuitui-native switches**: interactive cards, step reporting, debug logs.

> Long free-text values (lists, prompt) are re-validated server-side before writing: length, control
> characters and types. Client-side checks are UX only — the security boundary is the host.

### Core

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `appId` | string | `''` | Bot AppID (or `TUITUI_BOT_APPID`) |
| `appSecret` | string | `''` | Bot AppSecret (or `TUITUI_BOT_SECRET`) |
| `provider` / `model` | string | - | Override the LLM route; empty inherits the host default |
| `preset` | string | - | Agent preset id (applies to new sessions) |
| `cwd` | string | `~/.dsh-tuitui/workspace` | Agent working directory |
| `requireMention` | boolean | `true` | Require @bot in groups (fallback when `mentionPolicy` is unset) |
| `mentionPolicy` | `'require'` | `require` / `always` / `smart`: @ only / everything / model decides |
| `botAliases` | `[]` | Names the bot answers to; passed to the judging prompt as a hint |
| `smartFollowUpMs` | `120000` | Window where a reply from the same person counts as the same turn (ms) |
| `smartJudge.enabled` | `true` | Model-based interjection; disable to fall back to deterministic rules |
| `smartJudge.prompt` | built-in | **Judging prompt, fully editable** (Settings UI; empty restores default) |
| `smartJudge.maxHistory` | `12` | History messages handed to the model |
| `smartJudge.cooldownMs` | `20000` | Minimum gap between judgements per conversation |
| `smartJudge.timeoutMs` | `8000` | Judgement timeout (a timeout means "do not join") |
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

`access.c2cMode` / `access.groupMode` / `access.postMode` accept
`open` | `allowlist` | `blocklist` | `disabled`; the matching `c2cAllow`/`c2cBlock`,
`groupAllow`/`groupBlock`, `postAllow`/`postBlock` arrays take accounts or UIDs, group ids, and
channel/team ids. Deny lists win over everything. An empty allowlist in `allowlist` mode
**denies everyone** (fail-closed).

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

## How smart interjection works

With `mentionPolicy: 'smart'`, every group message (mentioned or not) goes through one judgement:

1. **Cooldown** — at most one judgement per `smartJudge.cooldownMs` per conversation; the rest are treated as "do not join" without spending tokens.
2. **Context** — the last `smartJudge.maxHistory` entries from the history buffer (with speakers; the bot's own lines are tagged `[you]`).
3. **Ask the model** — using the conversation's effective model, send `smartJudge.prompt` + history + the new message, and require a single JSON line: `{"join":true,"why":"..."}`.
4. **Fail closed** — timeouts, unparsable output, model errors, missing service: all mean `join:false`. Missing a reply beats spamming the room.
5. **Disable** (`smartJudge.enabled=false`) to fall back to deterministic rules: alias mention, or a follow-up from someone the bot just talked to.

The prompt is first-class configuration: different rooms need different personalities. Edit it in Settings;
clearing the box restores the factory default ([source](./src/shared/smart-prompt.ts)).

## Sessions & context

| Behaviour | Details |
| --- | --- |
| Session isolation | Key is `tuitui:<scope>:<peerId>`: direct by peer account, group by `group_id`, post by `channel_id` — separate contexts |
| Group context | Non-mentioned messages still enter the history buffer (`historyLimit`), and ship with the request when the bot is addressed |
| Idle eviction | After `sessionIdleTimeout` the in-memory agent is released; the next message restores the same session, context intact |
| Long-task protection | Sessions whose agent is not idle are never evicted, so long runs are not cut in half |
| Serial per peer | Messages from one peer queue up (`maxQueue`); different peers do not block each other |
| Quote resolution | The replied-to message travels along as a quote, so "what it said earlier" style references still resolve |

## Refresh / uninstall

Re-install the same spec to upgrade (the profile is replaced in place), then restart that profile:

```bash
dsh plugin --profile <name> add @eayonlee/dsh-tuitui-bot   # or a local tarball / checkout
dsh --profile <name>                                      # restart to load the new build
```

`dsh --profile <name> --dump-config | grep -A3 im-tuitui` confirms the plugin row is in the combined tree.

```bash
dsh plugin --profile <name> remove @eayonlee/dsh-tuitui-bot
# credentials live in the profile's cordis.patch.yml — delete them there if you want a clean slate
```

## FAQ

**The bot stays silent in a group.** Run `/auth` first, then check the trigger mode: `require` needs an
@-mention, `smart` depends on the judgement, only `always` answers everything. Posts also honour
`requireMentionInPost`.

**Smart mode is too quiet / too chatty.** Quiet: lower `smartJudge.cooldownMs` or make the prompt more
eager. Chatty: the opposite, or switch back to `require`.

**Settings refuses to unbind because credentials come from env vars.** Environment variables win over the
profile; remove `TUITUI_BOT_APPID` / `TUITUI_BOT_SECRET` in the deployment environment and restart.

**Config changes do not apply.** Saving in Settings writes the profile and triggers a reload; hand edits to
`cordis.patch.yml` need a restart.

**Why did one reply arrive as several messages?** Anything longer than `textChunkLimit` is split, and the
streaming fallback appends deltas instead of editing in place.

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

## Contributing

Issues and PRs are welcome — read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

- Bugs: use the [bug report](https://github.com/EayonLee/dsh-tuitui-bot/issues/new?template=bug_report.yml) template with the dsh version, plugin version and redacted logs;
- Features: use the [feature request](https://github.com/EayonLee/dsh-tuitui-bot/issues/new?template=feature_request.yml) template, and name the Tuitui SDK capability you would reuse;
- Before opening a PR: `npm run typecheck`, `npm test` and `npm run build` must pass;
- Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md); report security issues privately per [SECURITY.md](./SECURITY.md).

See [CHANGELOG_EN.md](./CHANGELOG_EN.md) for changes (Chinese: [CHANGELOG.md](./CHANGELOG.md)).

## Credits

- Host framework: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness);
- Platform SDK: [@qihoo/tuitui-bot-sdk](https://www.npmjs.com/package/@qihoo/tuitui-bot-sdk).

## License

[MIT](./LICENSE) © 2026 EayonLee and dsh-tuitui-bot contributors

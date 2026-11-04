# Changelog

This project (`@eayonlee/dsh-tuitui-bot`) is a dsh channel plugin for 360 Tuitui IM; versions evolve independently.

## 0.1.0

First release: an implementation of a dsh bot channel plugin for 360 Tuitui IM.

### Added

- **Tuitui channel adapter (`src/tuitui/`)**
  - `client.ts`: credentials, endpoint overrides (`TUITUI_BOT_API_BASE`, `TUITUI_BOT_WS_BASE`), SDK logger bridge
  - `inbound.ts`: normalization of `single_chat`, `group_chat`, `teams_post_create`, `interactive_action`
  - `sender.ts`: the `TuituiSender` implementation (text, interactive cards, files, in-place edits, recall, emoji reactions; posts go through `teams`)
  - `agent-reporter.ts`: native step reporting via `client.agent`
  - `shortcut.ts`: quick-command sync on startup
- **Own middleware kernel (`src/gateway/middleware/`)**: onion kernel plus 13 middlewares covering filtering, history, gating, sanitizing, rate limiting, commands and concurrency
- **Session layer (`src/session/`, `src/host/`, `src/model/`)**: single-flight creation, idle eviction, preset/model preference persistence, per-scope system prompts
- **Transport layer (`src/transport/`)**: markdown-aware chunking, streaming writer, outbound buffer, tool presentation, deliverable delivery, attachment download
- **Approval/questions (`src/features/`)**: native Tuitui interactive cards with a numbered-text fallback
- **Commands (`src/commands/`)**: `/new` `/compact` `/model` `/preset` `/status` `/stop` `/bot-ping` `/bot-version` `/bot-help` `/auth` `/bind`
- **Rich media (`src/media/`)**: `tuitui_send_file`, `tuitui_describe_image`, media TTL cleanup
- **In-app binding (`src/setup/`, `src/client/`)**: credential form + `property.info()` verification + profile persistence + settings panel

- **Smart interjection (`src/features/smart-judge.ts`)**: in `smart` mode a model reads the group context and decides whether to speak; the judging prompt is fully editable in Settings (default: `src/shared/smart-prompt.ts`), with per-conversation cooldown, timeout, and a fail-closed fallback
- **Settings page rework (`src/client/config-panel.ts`)**: section cards plus a two-column field grid that collapses on narrow screens; allow/deny lists and aliases are chip inputs (Enter commits, Backspace removes, × deletes one); workspace is a server-fed dropdown; smart mode reveals the prompt editor; model selection removed
- **Verdict now goes through a tool schema**: the `join_decision` JSON Schema is sent with the request and its arguments are read as the verdict; the prompt no longer carries the "output one JSON line" protocol
- **Judgement timeout 8s → 20s**, `maxTokens` 400 → 800: thinking models were getting cut off mid-reasoning (`why=unparsable`)
- **Timeouts log `why=timeout`** instead of blending into parse failures
- **Per-scope concurrency**: groups queue by default, direct chats interrupt and take the newest message, posts queue; all four strategies (queue / abort / merge / drop) are selectable in Settings
- **Settings page modularised**: grouped cards (each with its own background) plus a top nav that scrolls to the section; per-row explanations moved into tooltips
- **Receipt reactions**: `👀` on receipt, `✅` when done, `😵` on failure — all three configurable and disableable; groups included by default
- **Smart mode can answer with an emoji**: the verdict now allows `text / emoji / silent`
- **Judging defaults**: `maxTokens` 120 → 400 (thinking models need room), `cooldownMs` 20s → 5s
- **"Enable model judgement" switch and follow-up window removed**: smart mode has exactly one path — the model decides from the persona. If judgement is unavailable the bot stays quiet; no falling back to name matching or "someone it just talked to"
- **Defaults changed**: trigger mode defaults to `smart`; group context and judgement history default to 50; step reporting off; team posts disabled; file sending unrestricted by default
- **"Aliases" setting removed**: name matching fought the persona; judgement is now the model plus the persona prompt
- **Judging prompt rewritten**: no more "when in doubt stay quiet" checklist — it now describes situations and motives (interest, mood, boredom, having something to say) so the bot decides for itself
- **Brand icon**: plugin icon and the settings/sidebar/binding icons now use the official Tuitui logo (inlined base64, self-contained bundle)

### Runtime model notes

- New `post` scope (team channel posts); session key `tuitui:post:<channelId>`
- `reply-limiter` is an outbound throttling / duplicate guard: a minimum interval per target plus short-window dedupe, queueing instead of dropping
- Streaming is "send first message to obtain `msgid`, then `modifyText`", degrading to static sends when no msgid is available
- Binding is manual credentials plus online verification
- Smart triggering no longer relies on an "answer when the name appears" hard rule: the model decides, and deterministic rules only act as a fallback

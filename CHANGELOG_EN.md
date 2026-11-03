# Changelog

This project (`@qihoo/dsh-tuitui-bot`) is a Tuitui port of `@tencent-connect/dsh-qqbot`; versions evolve independently.

## 0.1.0

First release: a structural port of the QQ Bot channel plugin to a 360 Tuitui bot channel plugin.

### Added

- **Tuitui channel adapter (`src/tuitui/`)**
  - `client.ts`: credentials, endpoint overrides (`TUITUI_BOT_API_BASE`, `TUITUI_BOT_WS_BASE`), SDK logger bridge
  - `inbound.ts`: normalization of `single_chat`, `group_chat`, `teams_post_create`, `interactive_action`
  - `sender.ts`: the `TuituiSender` implementation (text, interactive cards, files, in-place edits, recall, emoji reactions; posts go through `teams`)
  - `agent-reporter.ts`: native step reporting via `client.agent`
  - `shortcut.ts`: quick-command sync on startup
- **Own middleware kernel (`src/gateway/middleware/`)**: onion kernel plus 13 middlewares matching the QQ SDK chain
- **Session layer (`src/session/`, `src/host/`, `src/model/`)**: single-flight creation, idle eviction, preset/model preference persistence, per-scope system prompts
- **Transport layer (`src/transport/`)**: markdown-aware chunking, streaming writer, outbound buffer, tool presentation, deliverable delivery, attachment download
- **Approval/questions (`src/features/`)**: native Tuitui interactive cards with a numbered-text fallback
- **Commands (`src/commands/`)**: `/new` `/compact` `/model` `/preset` `/status` `/stop` `/bot-ping` `/bot-version` `/bot-help` `/auth` `/bind`
- **Rich media (`src/media/`)**: `tuitui_send_file`, `tuitui_describe_image`, media TTL cleanup
- **In-app binding (`src/setup/`, `src/client/`)**: credential form + `property.info()` verification + profile persistence + settings panel

### Differences from the QQ version

- New `post` scope (team channel posts); session key `tuitui:post:<channelId>`
- No QQ passive-reply window (`reply-limiter` becomes outbound throttling / duplicate guard)
- Streaming is "send first message to obtain `msgid`, then `modifyText`", degrading to static sends when no msgid is available
- Binding is manual credentials plus online verification instead of a QR-code flow

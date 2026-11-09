# Changelog

> Scope: this English changelog mirrors releases from **0.1.29** onward. Everything before that
> lives only in the Chinese [CHANGELOG.md](./CHANGELOG.md) — the two files used to drift apart, and a
> partial second copy is worse than one honest pointer.

## Unreleased

### Fixed

- Binding state and settings returned 403 from a signed-in remote dsh Web browser. These routes now
  use dsh Connection owner-session admission; unauthenticated and cross-origin requests are still
  rejected, and self-update stays local-only (#70).
- Hosts without dsh Connection (embedded / minimal hosts) no longer lose the whole settings panel:
  the management routes fall back to the loopback-only rule instead of not mounting at all, which
  turned the panel into a 404 (PR #72).

## 0.1.34 (2026-11-07)

Experience and self-check only: a startup hint for new versions, no more manual credential exports
for the wiring self-check, and doc clean-up.

### Added

- One version check at startup: when a newer release exists it logs a single line
  ("有新版本 vX.Y.Z (current vA.B.C)") plus the upgrade command — **informational only, nothing is
  installed automatically**. Offline / rate-limited / unknown versions stay silent and never affect
  channel startup (PR #69).

### Changed

- `npm run verify` no longer requires manually exported credentials: environment / `.env` →
  `--profile <name>` → an automatic scan of `~/.dsh/profiles/*`. It prints where the credentials came
  from, never the values (PR #69).

### Docs

- The upgrade command is now `add @eayonlee/dsh-tuitui-bot@latest`: when the profile already pins a
  version, a bare `add` reinstalls that pinned version and only looks like an upgrade (PR #67).
- Both READMEs now state that npm and the release asset are byte-identical from 0.1.33 on, and that
  the v0.1.32 asset was re-uploaded from the npm build; the AGENTS counter-example no longer spells
  out a concrete version (PR #68).
- AGENTS lists the real `npm run verify -- --profile <name>` usage (PR #69).

## 0.1.33 (2026-11-07)

Main theme: everything left from the 2026-11-06 full-repo audit is fixed (#34–#49), and the install
docs carry no hardcoded version numbers any more.

### Docs

- Install docs no longer hardcode a version: npm is always `add @eayonlee/dsh-tuitui-bot`
  (no version = latest), and the release URL now uses the stable asset name
  `.../releases/latest/download/dsh-tuitui-bot.tgz`. Copying a command that pins `@0.1.32` is how
  people end up installing an old build, so no document carries a concrete version any more (only
  a `<version>` placeholder when pinning is the point). `scripts/pack.sh` now emits the stable alias
  too, releases upload both assets, and the AGENTS / CONTRIBUTING release steps follow suit.
### Fixed

- The one-click update failed outright when a release was missing its versioned asset; it now falls
  back to the stable alias `dsh-tuitui-bot.tgz` and still accepts only those two file names (#64).
- The attachment path allowlist is now on by default (`sendFile.restrictPaths: true`), and credential
  files (`cordis.patch.yml`), private keys (`*.pem` / `*.key` / `~/.ssh`), `.env` / `.npmrc` and
  `$DSH_HOME/profiles/**` are refused regardless of the switch. Previously any readable path was
  allowed, so one prompt injection in a group could send those files into the chat (#34).
- Under the merge concurrency strategy, messages merged into a survivor were still processed a second
  time on their own, so one message got two replies. Non-survivors now explicitly skip the downstream
  chain; messages released by the urgent path keep their previous behaviour (#35).
- The settings-page one-click update wrote a `file:` dependency pointing at a temporary tarball under
  `/tmp` that is deleted right after install, so every later `pnpm install` / `dsh plugin add` in that
  profile failed with ENOENT. The tarball is now persisted to `.dsh-tuitui-updates/` inside the profile
  (only the current version is kept) and installed from that stable path (#36).
- Outbound sends now time out after 15 s. A single request that connected but never returned used to
  hang that target's serial send chain forever, silently queueing every later reply and stalling
  deliverables and turn-end bookkeeping. The timeout only unblocks and warns; it does not retry, to
  avoid duplicating messages that did arrive (#37).
- A failed send no longer drops the content silently: each chunk is retried twice with backoff, and
  when it still fails the user gets a "N replies could not be sent" notice while the log records the
  failed count and a preview. The buffer used to be cleared unconditionally in `finally`, so replies
  vanished with only one error log line (#38).
- The settings-page write routes (bind / unbind / config / test-model) now require the request to come
  from the local machine, the same rule the about/update routes already used. Previously only the
  Origin check applied and requests without an Origin header (curl, scripts) were let through, so with
  `--host 0.0.0.0` or behind a reverse proxy anyone on the LAN could replace the credentials or unbind
  the bot (#44).
- The fallback instructions printed when auto-save fails no longer echo the AppSecret in plain text
  (stdout goes to `~/.dsh/web.log` under `dsh web`, and to the journal under systemd). Only the appId
  is printed, the secret is a placeholder (#44).
- Image generation now downloads the `url` form as binary. It used to read the image through
  `response.text()` and re-encode as latin1, which mangled PNG bytes such as `0x89` during UTF-8
  decoding, so every generated image came out corrupt (#43).
- `tuitui_describe_image` refuses private/loopback URLs (SSRF) and only reads local images inside
  media / the agent cwd / `sendFile.extraRoots`, instead of handing any readable file to an external
  vision endpoint (#43).
- The merge strategy no longer releases the lock early. The owner dropped the lock and cleared the
  state before the survivor ran the rest of the chain, so a single peer could end up with two
  concurrent chains fighting over history and the session. The lock is now handed to the survivor,
  which is responsible for releasing it (#39).
- The middleware error handler now ends the chain after catching an exception. Previously it neither
  rethrew nor skipped, so the integration layer processed the same message a second time: the user got
  "处理异常" and then a normal answer (#39).
- Text answers to pending questions/approvals are intercepted before the mention gate. In groups a bare
  "1" or "同意" usually does not @ the bot, so the gate skipped it and the answer never reached the
  channel until the turn timed out (#39).
- Attachment downloads gained three guards: a declared `content-length` over `media.maxMB` aborts
  immediately, the body is counted while streaming and cancelled the moment it exceeds the limit
  (it used to `arrayBuffer()` the whole thing first), and 3xx redirects are followed manually with the
  SSRF check re-run on **every** hop (previously only the first hop was checked, so a 302 to an intranet
  host slipped through) (#40).
- Turns truncated by the output limit (`max-tokens`) or interrupted no longer end silently: a short
  notice is appended so a half answer is not mistaken for a complete one (#40).
- Tool-call records are pruned per session at turn end. A `tool/result` is not guaranteed to arrive
  (interrupted turn, crashed tool), and deleting only on result let the map grow without bound in a
  long-running process (#40).
- `/model` no longer switches while a turn is generating: that fork disposed the running agent handle
  and cut the answer off mid-flight. It now refuses with "wait or /stop first", and says "applies to the
  next session" when there is no active session (#41).
- Fixed the race between `/new` and an in-flight session open: when `/new` landed before resume/create
  returned, the pending flow wrote the old sessionId back to prefs and put the stale record back into
  memory, overwriting the fresh `/new` (#41).
- Shutdown (`disposeAll`) now waits for in-flight openSession calls before clearing, so they cannot
  re-insert themselves afterwards and leave orphan sessions (#41).
- After a question or approval timed out (or was cancelled) the card's buttons stayed clickable — a
  click only produced "no pending question", and could even shift the answer into the next question.
  The card is now rewritten to "timed out / no longer valid" and the buttons are explicitly dead (#42).
- Fixed a hang when the abort landed while the card was being sent: the listener was registered after
  `await sendQuestion` (same for approvals), so an abort during that window never fired and the turn
  waited for the full timeout. The pending entry is now registered first and `signal.aborted` is
  re-checked right after the listener is attached (#42).
- The Settings page's extra prompts (`groupPrompt` / `directPrompt` / `postPrompt`) were missing from the
  server-side editable whitelist, so saving rejected the whole batch with a 400 (including every other
  field in that submit). They are now editable and validated like prompts: max 8000 characters, no
  control characters (#46).
- The profile-directory fallback for `link:` installs (contributors running from source) hardcoded
  `@qihoo/dsh-tuitui-bot`, so it never matched and the Settings page could be read but not saved
  ("profile directory not found"). It now scans `node_modules/@*/dsh-tuitui-bot`, so a renamed scope
  also resolves (#47).
- Self-echo filtering is back on: the chain explicitly passed
  `skipSelfEcho: false` while c2c has no mention gate, so any echoed message from the bot itself
  would start a self-reply loop. It is now enabled by default, plus an identity fallback that drops
  messages whose sender **is** the bot's own appId; a hit logs at info level (it should never happen —
  if it does, echoing is real) (#45).
- Approvals accept only the requester now: another group member clicking allow no longer authorises the
  tool run for someone else — they get "the requester has to decide" and the pending approval stays
  (`interactive.approvalRequesterOnly`, on by default; turn it off for the old "anyone may approve"
  behaviour). Questions remain collaborative: any group member may answer, first answer wins (#49).
- Gateway housekeeping: rate-limit buckets are dropped once empty and periodically swept when the key
  count grows (no more empty arrays for senders that never come back); the quote LRU no longer evicts an
  extra entry when overwriting an existing key; team posts get the "working on it" receipt too; the
  duplicate middleware-context implementation in bootstrap (last-reason-wins skip) is gone in favour of
  the kernel's first-reason-wins semantics (#48).

### Breaking changes

- Settings-page writes (bind / unbind / config / test-model) are now accepted only from the local
  machine. Opening the dsh web UI from another host via `--host 0.0.0.0` or a reverse proxy will get a
  403 for those actions; use SSH port forwarding (`ssh -L 3080:127.0.0.1:3080`) and operate from the
  local browser (#44).

### Changed

- Installation is now **exactly two channels**: the npm package (`@eayonlee/dsh-tuitui-bot`) and the
  GitHub release URL (`.../releases/download/v<version>/dsh-tuitui-bot-<version>.tgz`). Upgrading and
  uninstalling follow the same two. The `github:EayonLee/dsh-tuitui-bot` main-tracking instructions
  are gone; README / README_EN / AGENTS / CONTRIBUTING all match.

## 0.1.32 (2026-11-05)

In one line: when the GitHub API is rate-limited, "Check for updates" no longer turns into "check
failed".

### Fixed

- The update check falls back to `releases.atom`: the unauthenticated GitHub API allows 60 requests
  per hour **per IP**, which a shared office NAT exhausts easily (we hit 403 `API rate limit
  exceeded` for real). The atom feed lives on the web domain, is not rate-limited that way, and
  lists exactly the releases, so it is used when the API fails (reported as "GitHub Release (Atom)").
- Applying an update now builds the direct release URL from the version when the API is rate-limited
  or unreachable, so an available update is never a dead button; the tarball name and version are
  still verified after download.

### Changed

- Published to npm as of this version: `dsh plugin --profile <name> add @eayonlee/dsh-tuitui-bot`.
  `package.json` drops `private` and gains `publishConfig` (official registry + `access: public`);
  the npm package matches the GitHub Release version and `files` whitelist, and README / AGENTS now
  document three install paths.

## 0.1.31 (2026-11-05)

In one line: the settings page shows the installed version, checks for updates, and can hot-update
itself without restarting the process.

### Added

- Settings page gains an **About** block (#27): GitHub icon straight to the repository, the version
  actually installed in the profile (read from disk), and a one-click check against GitHub Release /
  main / jsDelivr taking the highest answer (6 h cache; a failed check reports the failure instead
  of claiming to be up to date).
- The update entry lives at the right end of the "bound" status row (same line as *Change
  credentials* / *Unbind*), not in its own settings block; enabled by default
  (`selfUpdate.enabled: false` keeps the check but disables installing). It only accepts
  `dsh-tuitui-bot-<version>.tgz` from this repository's releases, verifies sha256, backs up the
  previous directory, runs `pnpm add`, and re-adds the profile's `dsh.profile.bundles` entry. When
  the host provides `@deepseek-ai/dsh-hmr` it calls `reconcileProfile` to hot-reload the plugin so
  **no process restart is needed**; without HMR it says a restart is required; any failure rolls the
  previous version back.

### Changes

- Fixed: `dsh` metadata in `package.json` (`bundle.patch` / `client.platform` / `compatibility`)
  and `peerDependencies` were dropped by mistake while tidying docs (#19). Without the bundle
  patch dsh loads no entry at all, so the plugin vanished after a reinstall. All restored.
- `scripts/ship.sh` now verifies the profile's `dsh.profile.bundles` lists this package and adds
  it when missing, so that silent disappearance cannot repeat.
- Restart workflow unified on `sudo systemctl restart dsh-web`; no more `~/bin/dsh-restart`.
- Version strip polish (#27): the version is shown in full (never ellipsised); "Check for updates"
  stays clickable except while a check/install runs, and clicking it when already current replies
  "already up to date (vX.Y.Z)"; restart-required / check-failed (orange), up-to-date (green) and
  local-ahead (blue) states are colour-coded instead of grey text.
- Hardened update decisions (#27): the release channel trusts only the Release tag (main is no
  longer mixed in, which used to advertise a version whose asset did not exist); prerelease tags
  (`-beta.1`) are not treated as updates; before installing, the tarball is unpacked and its name,
  version and `dsh.compatibility.dshReleases` entry are checked against the running host, refusing
  anything unverified; `link:` development installs refuse to self-update.
- New config keys `selfUpdate.enabled` (default `false`) and `selfUpdate.channel`
  (`release` / `main`), editable from the settings page and applied through HMR like any other key.
- Inbound readability (issue #18): a message type the plugin cannot render no longer turns into
  an empty string — the body becomes `[未支持的消息类型: xxx]` and a `logger.warn` records the
  `msg_type`, chat and `msgid`; `tuitui_history` uses the same placeholder. Merged-forward and
  contact-card rendering are now pinned by tests against the SDK.
- Docs vs permissions (issue #18): `tuitui_send` documents that `strong_notice` / `phone_alarm`
  need a separately granted API permission; README gains a "what the bot can and cannot read"
  table, including that page messages can be sent but never read back.
- Document available token usage in Tuitui execution steps (#11).
- Install story narrowed to two paths: download the release tarball, or track main via `github:`.
  npm / one-shot script / local checkout instructions removed from README and README_EN
- Added [AGENTS.md](./AGENTS.md): layering, commands, release process, release-note standard, hard rules
- The project no longer publishes to npm (`private: true`); `install.sh` removed
- README restructured into nine sections (What it is / Quick start / What it can do / Configuration /
  Architecture / Development / Contributing / Credits / License); the old commands, tools, smart-interjection,
  reliability and context sections folded into them
- Releases now ship `dsh-tuitui-bot-<version>.tgz` as the recommended install source; the file name
  carries no scope prefix (`scripts/pack.sh` builds it — bare `npm pack` would write `eayonlee-...`)

## 0.1.29

Fixed "tools invisible to the model" ([#14](https://github.com/EayonLee/dsh-tuitui-bot/issues/14)):
seven tools had never registered because they were missing the `output` declaration dsh requires.

### Fixed

- `tuitui_group` / `tuitui_history` / `tuitui_file` / `tuitui_send` / `tuitui_bot` /
  `tuitui_teams` / `tuitui_draw` now declare `output: { schema, render }` (generated by the new
  `src/tuitui/tool-output.ts`: permissive object schema plus a generic summary renderer)
- Registration failures are logged as `error` instead of `warn`, and startup ends with a
  `可选能力注册 x/y` summary so a missing tool is visible at a glance

### Why it happened

`tools.register()` rejects any tool without `output.render`, and `runOptional` swallowed the
exception into a warning — startup stayed green while half of the documented tools were absent.

### Tests

New `src/tuitui/tool-registration.test.ts` (5 cases) replays dsh's validation rules across all nine
registration functions; full suite 869 passing.

This project (`@eayonlee/dsh-tuitui-bot`) is a dsh channel plugin for 360 Tuitui IM; versions evolve independently.

## 0.1.17

Image support no longer depends on dsh's own llm providers — point it at any OpenAI-compatible gateway.

### Added

- **Separate endpoints for understanding and generation** (`vision.*`, `imageGeneration.*`): base URL + API key + model id
- **`tuitui_draw` tool**: generates with the configured model, saves the file and sends it to the current chat
- **`/tuitui/im-tuitui/test-model` route**: the settings page's "Test connection" — probes `/models` only, no generation, no cost
- Settings page section "Image understanding & generation" with per-endpoint test buttons and an "already set" marker

### Changed

- `tuitui_describe_image` uses the direct endpoint when `vision.baseUrl` + `vision.apiKey` are set, otherwise falls back to the previous dsh llm path
- The "smart reply" section now explains what is actually being judged and notes that @-mentions bypass the judge

### Security

- Endpoint API keys are write-only: the config API never returns them; the page only shows whether one is stored

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
- **Full API surface exposed as tools**: new `tuitui_group` (7 actions), `tuitui_history` (chat records), `tuitui_file` (upload/query/file space), `tuitui_send` (link/page/mixed/recall/strong notice/phone alarm), `tuitui_bot` (identity/rename/avatar/shortcuts/workspace menus). Every write action requires `confirm=true`; reads are free
- **Group events feed the context**: `group_create` / `group_invite` / `group_kick` append a system line to the judge history
- **Outbound `@name` becomes a real mention**: parsed into Tuitui `at` metadata (code blocks / e-mails / `@all` excluded, merged with explicit `at`). Previously it was plain text, so other bots never got notified
- **All four concurrency strategies now act at the turn level**: `merge` used to behave like `queue` (the setting lied); it now really buffers while busy and sends one combined message afterwards
- **Inbound dedupe survives restarts**: msgids persist (FIFO 1000), so replays after a restart are not answered twice
- **Zombie connection self-healing**: connected with zero events for 30 minutes ⇒ resubscribe; a `[tuitui/watch]` status line every 5 minutes
- **Turn settle ceiling of 15 minutes**: a hung turn no longer blocks the conversation forever
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

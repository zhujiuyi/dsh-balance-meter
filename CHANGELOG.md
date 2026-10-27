# Changelog

## Unreleased

### Fixed

- **Z.ai / GLM quota windows are read correctly.** The live
  `GET /api/monitor/usage/quota/limit` answers with `data.limits[]` entries that
  name their span by a numeric unit code (3 = hours, 5 = months, 6 = weeks) and
  report the *used* share. The parser treated the weekly window and the monthly
  tool-call allowance as one unnamed "1-hour" window and could not show a number
  for either. Both token windows are now labelled and stored as remaining
  shares; the tool allowance is reported as a detail row.
- **A known vendor is no longer reported as an uncatalogued relay when the
  profile supplies its baseURL late.** pi-ai providers reach
  `listProviders()` without a baseURL, so the catalog match now runs again after
  the profile row fills it in. Z.ai routes were affected.

### Changed

- **The one-line readout lists every measurable window** instead of only the
  shortest span: `5 小时 剩 99% · 每周 剩 96%`. A plan fails on whichever window
  is exhausted, so hiding the weekly window could read as "available" while the
  account was already blocked.
- **The composer chip shows both windows**, with the 5-hour label in green, the
  weekly label in blue, a 0%-remaining label in red, and the numbers white. The
  ring gauge now tracks the window with the least remaining.

## 0.2.5

This is the first release published to npm since **0.2.0**, so it carries the
0.2.1 and 0.2.2 fixes with it. If you are upgrading from 0.2.0, read those two
sections below — both were real, user-visible bugs.

Summary of what changed since 0.2.0:

- **Automatic refresh actually renews the reading you are looking at.** It used
  to renew the *default* route instead, so a profile with more than one provider
  could show a reading that never updated.
- **A reading older than 5 minutes is refreshed** even when the minimum interval
  has not elapsed. New `staleAfterSec` setting (default 300; 0 disables).
- **The first read no longer fails** with `请求失败：fetch failed` on a cold
  connection. Transient transport failures are retried once.
- README rewritten for humans, with screenshots (`docs/images/`).

## 0.2.2

### Fixed — the first read failed with "请求失败：fetch failed"

A fresh TLS connection to some of these hosts is intermittently reset before it is
established. Measured on a real machine, cold connections to `opencode.ai` failed
2 of 4 attempts with `ECONNRESET` (and `amr-link.open-design.ai` 1 of 4) while a
warm connection then succeeded ten times in a row.

Because the plugin made exactly one attempt per endpoint, and a catalogued route
has only one candidate URL, a single reset became the visible result: the panel
opened showing `请求失败：fetch failed`, and a later trigger worked — the
"only fails the first time" symptom. It was never specific to one vendor.

- New `plugin/transport.mjs` retries transient transport failures once (two
  attempts, 150 ms apart). A cold-connection reset now recovers instead of
  surfacing.
- Wired into all three network paths: the catalog query, the relay-preset chain,
  and the OpenDesign control-plane adapter. The policy lives in one place so the
  three cannot drift apart.
- What is **not** retried, deliberately: HTTP statuses (a 401 will still be 401,
  so the query layer's "stop after a credential rejection" stays intact) and
  cancellations (including deadlines — a timeout has already spent its budget).
- Measured effect: 8 cold attempts against `opencode.ai` went from 1 failure
  without the retry to 0 with it.

### Tests

305 tests, up from 288. `test/transport.test.mjs` pins the retry policy, and
`test/query.test.mjs` proves the query layer recovers a reading that a reset
would previously have turned into an error. Both were verified to fail when the
retry is disabled.

## 0.2.1

### Fixed — automatic refresh never renewed the reading on screen

Both automatic triggers (the 15-second tick and `turn/end`) refreshed
`pickPrimaryRoute()`, the route this plugin would *default* to. The chip asks the
snapshot route for `?route=<the session's provider>`, which is the route the user
is actually looking at. With more than one discovered route those two differ — a
profile with `deepseek` and `opendesign` kept refreshing `deepseek` while the
panel displayed `opendesign`, so the visible reading could sit unchanged for the
better part of an hour.

- The snapshot route now records the route it answered for, and the automatic
  triggers renew that one. `pickPrimaryRoute()` is used only before anything has
  asked, which is the first-paint case it was meant for.

### Changed — a freshness ceiling

`minIntervalSec` was a floor on how often an automatic refresh may happen, never
that one happens at all: a route could stay stale indefinitely as long as nothing
else called. A reading older than the ceiling is now renewed even when the floor
has not elapsed.

- New setting `staleAfterSec`, default **300** (5 minutes); `0` disables it and
  restores paced-only behaviour.
- The failure cooldown still applies, so a route that is erroring is not hammered
  just because its last good reading is old. `store.mayRetry()` is the gate that
  ignores pacing but honours the cooldown and the in-flight check.
- Staleness is measured from the last *successful* read, not the last attempt: a
  route that keeps failing must not look fresh because the attempts keep coming.

### Tests

288 tests, up from 282. The new cases cover route-target selection (and were
verified to fail when the fix is reverted — a green test before the fix would have
been a lie), plus the ceiling's interaction with the pacing floor, the failure
cooldown, and an in-flight query.

## 0.2.0

### Added — OpenDesign (AMR) support

OpenDesign is the first provider whose billing is **not on the route's host**, and
the first whose credential is not the DSH-held API key. Both facts forced a
separate adapter rather than another catalog entry:

- The `opendesign` route points at the inference gateway
  `amr-link.open-design.ai`, which serves only `/v1/models`,
  `/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/embeddings` and
  `/v1/images/generations`. Every billing path there returns 404.
- Balance and Design Plan windows live on the control plane
  `amr-api.open-design.ai`, a different host. No `{origin}` template can express
  that, so these rows live in `CONTROL_ENTRIES` and are answered by
  `plugin/opendesign.mjs`.
- The control plane rejects the `sk-amr-…` runtime key for billing reads. The
  plugin therefore reads the `controlKey` that `vela login` / the OpenDesign
  desktop client writes to `~/.amr/config.json`, resolving `$AMR_HOME` first and
  the profile from `OPEN_DESIGN_AMR_PROFILE` / `VELA_PROFILE` (default `prod`).
- One read of `billing/preflight` returns both the wallet balance and the plan
  windows. The per-window `coding-plan-usage` route the Cloud console uses is
  session-authenticated only and answers 401 to a controlKey, so it is not used.
- Partial reads stay honest: a readable wallet with an unreadable plan still
  shows the wallet and lists the reason as a detail row.

### Added — reading history

The host now keeps the last 80 readings per route and window
(`state.mjs` → `history()`), and the snapshot carries them. This exists because
the redesigned panel draws a trend: a curve implies history, so it is drawn only
from readings that actually happened. With fewer than two samples the panel says
it is still collecting rather than inventing a line.

### Changed — readout and panel redesign

The trigger and the popover were rebuilt to a telemetry-instrument design:
a pill trigger with a pulsing status dot, and a panel with a large remaining
share, a 64-tick ring gauge, segmented per-window bars, a staggered entrance,
a scan sweep on refresh, and the provider/endpoint/read-time block.

Three deliberate departures from the design mock:

1. the trend is drawn from real readings, not a hardcoded series;
2. colours resolve through `--dsw-*` theme tokens, while the instrument marks
   (gauge arc, bar gradient) keep their own palette;
3. a window with no readable share shows its name and the reason instead of a
   zero-width bar — 0% would read as "exhausted" when the truth is "unread".

### Fixed

- The readout could disappear entirely from the composer: a `useMemo` referenced
  `state` before its `const` declaration, which threw
  `ReferenceError: Cannot access 'state' before initialization` at render time.
  Syntax checks and the contract check cannot see this class of bug, so
  `test/client.test.mjs` now renders the real bundle across its states.
- `allowedHosts()` now returns `ALLOWED_HOSTS`, so the OpenDesign control plane
  is covered; the previous version only listed catalog base URLs.
- Reading histories are returned as copies, so a caller cannot mutate them.

### Tests

282 tests, up from 222 before this release (measured with `npm test` on commit
`eaa5ef4`, the last 0.1.0-tree commit, and on this tree). The additions cover the
OpenDesign adapter (36), browser-half rendering (10), reading history (8), the
control-plane catalog entry, and the endpoint/route assertions those changes
required.

## 0.1.0

Initial release: DeepSeek, OpenRouter, Moonshot/Kimi, SiliconFlow, 智谱 GLM /
Z.AI, Kimi Coding, MiniMax and OpenCode Go, plus a conventional relay-panel
preset chain for routes the catalog does not know. No subprocesses, no `exec`
capability; contact is limited to catalogued vendor hosts.

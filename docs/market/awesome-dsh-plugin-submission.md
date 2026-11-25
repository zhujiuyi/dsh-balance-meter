# Submission for awesome-dsh-plugin

**Status: listed.** PR #8156 →
https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/8156
was reviewed on 2026-10-19 and **closed, not merged**: the maintainer accepted the
entry, corrected two details in it, and committed it themselves. The live file is
`data/plugins/zhujiuyi__dsh-balance-meter.yml` on `main`:

- added the OpenDesign precondition (`vela login`, or a desktop `controlKey` in
  `~/.amr/config.json`);
- narrowed "a miss reports its cause with the response echoed" to **parse
  failures only** — other failures just report the reason.

Both corrections are already reflected in the description below, so a later PR
against the entry changes one file and nothing else.

**Follow-up: PR #18893** →
https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/18893
(0.3.0, one file, description only) adds the multi-window readout to the
description — the entry otherwise auto-derives `version` and `downloads` from npm,
so a publish needs no entry change at all.

Target path in the index repo: `data/plugins/zhujiuyi__dsh-balance-meter.yml`

Open a PR against https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
that adds exactly this one file. Nothing else is needed — both READMEs are
regenerated on `main` after merge, so do not edit them by hand.

```yaml
url: https://github.com/zhujiuyi/dsh-balance-meter
name: zhujiuyi/dsh-balance-meter
category: usage
description:
  en: 'Reads the API balance or subscription quota behind the current DSH route — including OpenDesign (AMR) wallet and Design Plan windows via the control plane — shows every quota window a plan can fail on (5-hour, weekly, monthly) rather than only the shortest, and never guesses a figure: a miss reports its cause (the raw response is echoed only when parsing fails). OpenDesign needs `vela login` or a desktop `controlKey` in `~/.amr/config.json`.'
  zh: '读取当前 DSH 路由背后的 API 余额或订阅余量——包括经控制面读取 OpenDesign（AMR）的钱包与 Design Plan 窗口——逐窗显示套餐会在哪一道闸先耗尽（5 小时 / 每周 / 每月），而非只看最短窗口；绝不猜数字：查不到时如实说明原因（仅解析失败时附原始响应）。OpenDesign 需先 `vela login` 或在桌面端写入 `~/.amr/config.json` 的 controlKey。'
```

## Why the description carries quotes

Both descriptions contain `: ` (colon + space) — `"a miss reports its cause"`
appears after one. Per `contributing.md`, an unquoted `: ` makes YAML parse the
rest as a nested key, so the quoting is required, not stylistic.

## Checklist against the review requirements

| Requirement | Status |
|---|---|
| `dsh.bundle` manifest in `package.json` | ✅ `{"bundle": {"patch": "./cordis.patch.yml"}}` |
| `cordis.patch.yml` at repo root | ✅ present, registers row `balance-meter` |
| Repo at least 1 day old | ✅ created 2026-10-14 (5 days) |
| `dsh-plugin` topic | ✅ present |
| Real, working code | ✅ 308 tests, contract check, live-verified against 7 vendor endpoints |
| Not a meta-package | ✅ ships behaviour; depends on nothing at runtime |
| Category reasonable | `usage` = "Usage & Billing" — the entry's whole job |

## Listing fields, derived from npm

`@zhujiuyi/dsh-balance` is live on npmjs (first published 2026-10-19; `latest` is
`0.3.0`), so the index derives these:

- `npm`: `@zhujiuyi/dsh-balance`
- `version`: `dist-tags.latest` — the entry file carries no version of its own,
  so a publish is picked up on the next regeneration without touching the entry
- `install`: `dsh plugin --profile web add @zhujiuyi/dsh-balance`
- `downloads`: counted from the npm download API

Note for anyone re-verifying: `0.0.0-stage` also appears in the version list.
That is npm's own placeholder for a newly created scoped package
(`"stub": true`, "Temporary package placeholder for staged publishing"), not
something this repo published.

### Why `registry.npmjs.org` may 404 locally

On the machine this was published from, `registry.npmjs.org` resolves to
`198.18.0.43` — the fake-IP range a proxy's TUN mode hands out — while the real
Cloudflare addresses are `104.16.x.x`. Queries over that path returned 404 for a
package that existed; jsDelivr and unpkg (which read npmjs directly) both
confirmed it. If a local `npm view` says the package is missing, check
`Resolve-DnsName registry.npmjs.org` before concluding the publish failed.

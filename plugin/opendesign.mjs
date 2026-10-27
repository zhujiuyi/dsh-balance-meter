/**
 * OpenDesign (AMR) subscription quota + wallet adapter — pure reads, no ctx.
 *
 * Why this module exists at all, and why it is not a catalog endpoint:
 *
 * OpenDesign is not a normal relay. The DSH route `opendesign` points at
 * `https://amr-link.open-design.ai/v1`, which is Link — the *inference* gateway.
 * Link serves `/v1/models`, `/v1/chat/completions`, `/v1/messages`,
 * `/v1/responses`, `/v1/embeddings` and `/v1/images/generations`, and nothing
 * else: every `/usage`, `/quota`, `/balance`, `/credits`, `/billing` path on
 * that host is a 404. Billing truth lives on the *control plane*,
 * `https://amr-api.open-design.ai`, which is a different host than the route's
 * baseURL. A `{origin}`-templated endpoint therefore cannot reach it, which is
 * why the route is answered by this module instead of by `runQuery`.
 *
 * Credential: OpenDesign deliberately rejects the API key DSH holds. Link's
 * `sk-amr-…` runtime key is documented as *not* accepted for wallet reads — the
 * control plane requires the `controlKey` that `vela login` / the OpenDesign
 * desktop client writes to `~/.amr/config.json`. No controlKey, no billing read;
 * that is the vendor's rule, not a limitation of this plugin.
 *
 * Response shapes are taken from OpenDesign's own clients rather than guessed,
 * and then verified against the live control plane:
 *   - `packages/contracts/src/api/amrWallet.ts` (`balanceUsd` is a decimal string)
 *   - `apps/daemon/src/integrations/vela-wallet.ts`
 *     (`GET /api/v1/wallet/balance`, `Authorization: Bearer <controlKey>`)
 *   - `specs/current/amr-wallet-balance-vela-handoff.md` (401/403 semantics)
 *   - `GET /api/v1/workspaces` → `{items:[{workspaceId, workspaceType, …}]}`
 *   - `GET /api/v1/workspaces/:id/billing/preflight` → `{balanceUsd,
 *     codingPlan:{tier, windows:[{policyId, durationSeconds, resetMode,
 * `usedCredits, limitCredits, remainingCredits, windowStart, resetsAt}]},
 *     funding}`
 *
 * One thing the live control plane contradicted in the console bundle: the
 * per-window route the cloud console calls
 * (`/v1/workspaces/:id/billing/coding-plan-usage`) is **session-authenticated
 * only** — it answers 401 to a controlKey. `billing/preflight` is the route that
 * actually admits one, and it carries both the balance and the windows, so that
 * is what this adapter reads.
 *
 * Every parse path fails loudly: a figure this module cannot justify is
 * reported as a failure with the response echoed, never as a plausible number.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { clampPct, formatMoney } from './parse.mjs'
import { STATUS } from './state.mjs'
import { fetchWithRetry } from './transport.mjs'

/** Hosts this adapter may contact. Exported so the docs can assert the set. */
export const OPEN_DESIGN_HOSTS = Object.freeze([
  'amr-api.open-design.ai',
  'amr-link.open-design.ai',
])

/** Where OpenDesign's own clients look for the AMR login profile. */
export const AMR_CONFIG_DIR = '.amr'

/** The control plane used when the login profile does not name one. */
export const DEFAULT_AMR_API_URL = 'https://amr-api.open-design.ai'

/** How much of an unparseable body is echoed back for diagnosis. */
const ECHO_LIMIT = 400

/** Profile names the vendor's CLI accepts; anything else falls back to `prod`. */
const KNOWN_PROFILES = new Set(['prod', 'test', 'feature-test', 'local'])

/**
 * @typedef {object} AmrLogin
 * @property {boolean} ok            True when a controlKey was found.
 * @property {string} profile        Profile the key was read from.
 * @property {string | null} controlKey
 * @property {string} apiUrl         Control-plane base URL.
 * @property {string} configPath     File that was read.
 * @property {string | null} reason  Why it is not usable, when `ok` is false.
 */

/**
 * Resolve the AMR config file path exactly as the vendor's daemon does:
 * `$AMR_HOME/config.json`, else `<home>/.amr/config.json`.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveConfigPath(env = process.env) {
  const raw = typeof env.AMR_HOME === 'string' ? env.AMR_HOME.trim() : ''
  if (raw === '') return join(homedir(), AMR_CONFIG_DIR, 'config.json')
  if (raw === '~') return join(homedir(), 'config.json')
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return join(homedir(), raw.slice(2), 'config.json')
  return join(raw, 'config.json')
}

/**
 * Pick the profile the vendor's own clients would pick.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveProfileName(env = process.env) {
  const raw = String(env.OPEN_DESIGN_AMR_PROFILE ?? env.VELA_PROFILE ?? '').trim()
  return KNOWN_PROFILES.has(raw) ? raw : 'prod'
}

/**
 * Read the stored AMR login from a parsed config document.
 *
 * The profile the environment names is authoritative when it exists; when it
 * does not, a config carrying exactly one profile is used as-is (a fresh
 * install writes only that one), and otherwise the read fails rather than
 * picking an account by guesswork.
 * @param {unknown} config
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [configPath]
 * @returns {AmrLogin}
 */
export function readAmrLogin(config, env = process.env, configPath = resolveConfigPath(env)) {
  const base = {
    ok: false,
    profile: resolveProfileName(env),
    controlKey: null,
    apiUrl: DEFAULT_AMR_API_URL,
    configPath,
  }
  const profiles = config !== null && typeof config === 'object' ? config.profiles : undefined
  if (profiles === null || typeof profiles !== 'object') {
    return { ...base, reason: `配置里没有 profiles 段：${configPath}` }
  }
  const names = Object.keys(profiles)
  if (names.length === 0) {
    return { ...base, reason: `配置里没有任何登录档案：${configPath}` }
  }
  let profile = base.profile
  if (!names.includes(profile)) {
    if (names.length !== 1) {
      return {
        ...base,
        reason: `配置里没有「${profile}」档案（现有：${names.join('、')}）。`
          + '可用 OPEN_DESIGN_AMR_PROFILE 指定要读哪一个。',
      }
    }
    profile = names[0]
  }
  const stored = profiles[profile]
  const record = stored !== null && typeof stored === 'object' ? stored : {}
  const controlKey = typeof record.controlKey === 'string' ? record.controlKey.trim() : ''
  const apiUrl = (typeof record.apiUrl === 'string' && record.apiUrl.trim() !== ''
    ? record.apiUrl.trim()
    : typeof env.VELA_API_URL === 'string' && env.VELA_API_URL.trim() !== ''
      ? env.VELA_API_URL.trim()
      : DEFAULT_AMR_API_URL)
  if (controlKey === '') {
    return {
      ...base,
      profile,
      apiUrl,
      reason: `档案「${profile}」里没有 controlKey，说明本机还没完成 AMR 登录：${configPath}`,
    }
  }
  return { ok: true, profile, controlKey, apiUrl, configPath, reason: null }
}

/**
 * Read and parse the AMR config file, tolerating every absent/malformed case.
 * @param {string} path
 * @param {{ readFile?: (path: string) => string }} [io]
 * @returns {{ ok: true, config: unknown } | { ok: false, reason: string }}
 */
export function readAmrConfigFile(path, io = {}) {
  const read = typeof io.readFile === 'function' ? io.readFile : (target) => readFileSync(target, 'utf8')
  let text
  try {
    text = read(path)
  } catch (error) {
    const code = error !== null && typeof error === 'object' ? error.code : undefined
    if (code === 'ENOENT') {
      return {
        ok: false,
        reason: `本机没有 OpenDesign 的登录态（${path} 不存在）。`
          + '安装 OpenDesign 桌面端或运行一次 `vela login` 后，该文件会自动出现。',
      }
    }
    return { ok: false, reason: `读取 ${path} 失败：${errorText(error)}` }
  }
  try {
    return { ok: true, config: JSON.parse(text) }
  } catch (error) {
    return { ok: false, reason: `${path} 不是合法 JSON：${errorText(error)}` }
  }
}

/**
 * Resolve the AMR login profile from disk.
 * @param {{ env?: Record<string, string | undefined>, readFile?: (path: string) => string }} [options]
 * @returns {{ ok: true, login: AmrLogin } | { ok: false, login: AmrLogin }}
 */
export function resolveAmrLogin(options = {}) {
  const env = options.env ?? process.env
  const configPath = resolveConfigPath(env)
  const file = readAmrConfigFile(configPath, options)
  if (!file.ok) {
    return {
      ok: false,
      login: {
        ok: false,
        profile: resolveProfileName(env),
        controlKey: null,
        apiUrl: DEFAULT_AMR_API_URL,
        configPath,
        reason: file.reason,
      },
    }
  }
  const login = readAmrLogin(file.config, env, configPath)
  return { ok: login.ok, login }
}

/**
 * Name a coding-plan window from its duration, the way the vendor's own panel
 * does — derived from `durationSeconds` rather than a table of policy ids,
 * because the window set is the backend's to change.
 * @param {unknown} durationSeconds
 * @returns {string}
 */
export function windowLabel(durationSeconds) {
  const seconds = Number(durationSeconds)
  if (!Number.isFinite(seconds) || seconds <= 0) return '额度窗口'
  const day = 86_400
  const hour = 3_600
  if (seconds % day === 0) return `${seconds / day} 天`
  if (seconds % hour === 0) return `${seconds / hour} 小时`
  return `${Math.round(seconds / hour)} 小时`
}

/**
 * Read a credit count. The vendor sends decimal strings that can exceed
 * `Number.MAX_SAFE_INTEGER`, so the exact value is kept as a BigInt.
 * @param {unknown} value
 * @returns {bigint | null}
 */
export function creditCount(value) {
  if (typeof value === 'bigint') return value >= 0n ? value : null
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return BigInt(value.trim())
  return null
}

/**
 * Derive the remaining share of a window from its used/limit credits.
 *
 * The ratio is taken in BigInt before it ever becomes a float, mirroring the
 * vendor's own panel: a plan pool is far past 2^53 and a float ratio drifts.
 * @param {unknown} used
 * @param {unknown} limit
 * @returns {number | null} 0..100, or null when the pair is not readable.
 */
export function remainingPercent(used, limit) {
  const usedCount = creditCount(used)
  const limitCount = creditCount(limit)
  if (usedCount === null || limitCount === null || limitCount <= 0n) return null
  const basisPoints = Number((usedCount * 10_000n) / limitCount)
  return clampPct(100 - Math.round(basisPoints / 100))
}

/**
 * Parse a Coding Plan block — the `codingPlan` object inside the preflight
 * response, or a standalone body of the same shape.
 *
 * Returns an empty window list rather than throwing, because "no windows" is a
 * real answer (an account with no Coding Plan, or a free tier): the caller
 * decides whether that means a balance-only readout or a parse failure.
 * @param {unknown} body
 * @returns {{ tier: string | null, eligible: boolean, windows: object[] }}
 */
export function parseCodingPlanUsage(body) {
  const root = body !== null && typeof body === 'object' ? body : {}
  const tierRaw = root.tier
  const tier = typeof tierRaw === 'string' && tierRaw.trim() !== '' ? tierRaw.trim() : null
  const windows = Array.isArray(root.windows) ? root.windows : []
  const parsed = []
  for (const [index, entry] of windows.entries()) {
    if (entry === null || typeof entry !== 'object') continue
    const limit = creditCount(entry.limitCredits)
    const used = creditCount(entry.usedCredits)
    const remaining = creditCount(entry.remainingCredits)
    // Fall back to limit-minus-remaining when the panel omits usedCredits.
    const usedCount = used ?? (limit !== null && remaining !== null ? limit - remaining : null)
    const pct = remainingPercent(usedCount, limit)
    const label = windowLabel(entry.durationSeconds)
    parsed.push({
      key: typeof entry.policyId === 'string' && entry.policyId !== '' ? entry.policyId : `w${index}`,
      label: `Design Plan · ${label}`,
      // The client renders `remainingPct`; a window with an unreadable pair is
      // still listed (it names a real limit) but carries no bar.
      used: toSafeNumber(usedCount),
      limit: toSafeNumber(limit),
      remainingPct: pct,
      ...(typeof entry.resetsAt === 'string' && entry.resetsAt !== '' ? { resetAt: entry.resetsAt } : {}),
      ...(pct === null ? { note: '接口未给出可读的 usedCredits / limitCredits 组合' } : {}),
      durationSeconds: Number.isFinite(Number(entry.durationSeconds)) ? Number(entry.durationSeconds) : null,
    })
  }
  parsed.sort((left, right) => (left.durationSeconds ?? 0) - (right.durationSeconds ?? 0))
  return {
    tier,
    eligible: root.eligible === true,
    windows: parsed,
  }
}

/**
 * Coerce a BigInt to a number when it is safe to do so, else null.
 * The client only uses the exact share, so a giant count becoming null costs
 * nothing and avoids silently rounding a figure the user might compare against.
 * @param {bigint | null} value
 * @returns {number | null}
 */
function toSafeNumber(value) {
  if (value === null) return null
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null
}

/**
 * Parse `GET /api/v1/wallet/balance` → `{ balanceUsd: string, updatedAt }`.
 * @param {unknown} body
 * @returns {{ amount: number, updatedAt: string | null }}
 */
export function parseWalletBalance(body) {
  const root = body !== null && typeof body === 'object' ? body : {}
  const raw = root.balanceUsd
  const amount = typeof raw === 'string' && /^-?\d+(?:\.\d+)?$/.test(raw.trim())
    ? Number(raw.trim())
    : typeof raw === 'number' && Number.isFinite(raw)
      ? raw
      : null
  if (amount === null) {
    const error = new Error('响应里没有可读的 balanceUsd')
    error.name = 'OpenDesignParseError'
    throw error
  }
  return {
    amount,
    updatedAt: typeof root.updatedAt === 'string' && root.updatedAt !== '' ? root.updatedAt : null,
  }
}

/**
 * Find a workspace id in `GET /api/v1/workspaces`.
 *
 * Verified live shape: `{"items":[{workspaceId, workspaceName, workspaceType,
 * workspaceMemberId, role, …}]}`. The bare-array / `workspaces` / `data`
 * spellings are accepted too, so a console that changes its envelope again
 * does not silently read as "no workspaces" — which is exactly the failure this
 * parser was written to avoid after the first live run reported none.
 *
 * A personal workspace is preferred because that is the one an individual
 * subscription bills against; a team workspace is used only when no personal
 * one is listed.
 * @param {unknown} body
 * @returns {{ workspaceId: string, type: string | null, memberId: string | null } | null}
 */
export function pickWorkspace(body) {
  const list = Array.isArray(body)
    ? body
    : Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body?.workspaces)
        ? body.workspaces
        : Array.isArray(body?.data)
          ? body.data
          : []
  const rows = list
    .filter((entry) => entry !== null && typeof entry === 'object')
    .map((entry) => ({
      workspaceId: textOf(entry.workspaceId) ?? textOf(entry.id),
      type: textOf(entry.workspaceType) ?? textOf(entry.type),
      memberId: textOf(entry.workspaceMemberId),
    }))
    .filter((entry) => entry.workspaceId !== null)
  if (rows.length === 0) return null
  const personal = rows.find((entry) => entry.type === 'personal')
  return personal ?? rows[0]
}

/**
 * Query OpenDesign for the account's Design Plan windows and wallet balance.
 *
 * Two independent reads are attempted, and what came back is reported as-is:
 * a control plane that refuses the window endpoint still yields the wallet
 * figure, because showing one true number beats showing none. Every failure
 * names the step that failed and why.
 *
 * @param {object} input
 * @param {typeof fetch} input.fetchImpl
 * @param {{ env?: Record<string, string | undefined>, readFile?: (path: string) => string }} [input.io]
 * @param {number} [input.timeoutMs]
 * @param {AbortSignal} [input.signal]
 * @returns {Promise<{ status: string, result: object | null, url: string | null, message: string | null, raw: string | null }>}
 */
export async function runOpenDesignQuery(input) {
  const timeoutMs = Number.isFinite(input.timeoutMs) ? input.timeoutMs : 8000
  const resolved = resolveAmrLogin(input.io ?? {})
  const login = resolved.login

  if (!login.ok) {
    return {
      status: STATUS.NO_CREDENTIAL,
      result: null,
      url: null,
      message: `${login.reason ?? '找不到 OpenDesign 的 controlKey。'}`
        + 'OpenDesign 的额度与钱包只能用它登录产生的 controlKey 读取——'
        + 'DSH 里配置的 sk-amr-… API Key 是推理用的 runtime key，官方明确拒绝对它开放账单接口。',
      raw: null,
    }
  }

  const apiUrl = login.apiUrl.replace(/\/+$/, '')
  const headers = { authorization: `Bearer ${login.controlKey}`, accept: 'application/json' }

  // ── the workspace this account bills against ──────────────────────────────
  const workspace = await readWorkspace(input, apiUrl, headers, timeoutMs)
  if (!workspace.ok) {
    // Without a workspace there is no account-scoped read to make. This is a
    // real failure, not an empty reading: say which step broke.
    return {
      status: workspace.status,
      result: null,
      url: workspace.url,
      message: workspace.message,
      raw: workspace.raw,
    }
  }

  // ── one authenticated read for balance *and* plan windows ─────────────────
  // `billing/preflight` is the endpoint OpenDesign's own clients use for this
  // account snapshot, and it is the one the control plane actually admits a
  // controlKey to. The per-window `coding-plan-usage` route the console uses
  // requires a browser session and answers 401 to a controlKey, so it is not a
  // candidate here.
  const preflightUrl = `${apiUrl}/api/v1/workspaces/${encodeURIComponent(workspace.workspaceId)}/billing/preflight`
  const preflight = await getJson(input.fetchImpl, preflightUrl, headers, timeoutMs, input.signal)
  if (preflight.ok) {
    const snapshot = parsePreflight(preflight.body)
    if (snapshot !== null) {
      return success(preflightUrl, snapshot)
    }
    return {
      status: STATUS.PARSE_FAILED,
      result: null,
      url: preflightUrl,
      message: '账单预检接口返回了无法识别的结构（找不到 balanceUsd / codingPlan）。',
      raw: echo(preflight.raw),
    }
  }
  // A 401/403 here means the controlKey itself is not accepted; anything else
  // may be a transient control-plane fault. Either way the wallet route below
  // is tried, because a true number beats no number.
  const walletUrl = `${apiUrl}/api/v1/wallet/balance`
  const wallet = await getJson(input.fetchImpl, walletUrl, headers, timeoutMs, input.signal)
  if (!wallet.ok) {
    return {
      status: preflight.status === 401 || preflight.status === 403 || wallet.status === 401 || wallet.status === 403
        ? STATUS.HTTP_ERROR
        : preflight.status === null || wallet.status === null
          ? STATUS.NETWORK_ERROR
          : STATUS.HTTP_ERROR,
      result: null,
      url: walletUrl,
      message: walletMessage(wallet, login),
      raw: wallet.raw,
    }
  }
  let walletResult
  try {
    walletResult = parseWalletBalance(wallet.body)
  } catch (error) {
    return {
      status: STATUS.PARSE_FAILED,
      result: null,
      url: walletUrl,
      message: `钱包接口返回了无法识别的结构：${errorText(error)}`,
      raw: echo(wallet.raw),
    }
  }
  // The tier still comes from the summary when the preflight route is down, so
  // the readout keeps naming the plan rather than only the money.
  const summary = await getJson(
    input.fetchImpl,
    `${apiUrl}/api/v1/billing/summary`,
    headers,
    timeoutMs,
    input.signal,
  )
  const tier = summary.ok ? textOf(summary.body?.membershipTier) : null
  return success(walletUrl, {
    amount: walletResult.amount,
    tier,
    windows: [],
    note: `读取套餐窗口失败（${preflight.status ?? '网络错误'}），钱包余额仍可正常读取。`,
  })
}

/**
 * Shape one successful read into the adapter's outcome.
 * @param {string} url
 * @param {{ amount: number | null, tier: string | null, windows: object[], note?: string }} snapshot
 */
function success(url, snapshot) {
  const windows = snapshot.windows
  const measured = windows.filter((window) => window.remainingPct !== null)
  const money = snapshot.amount === null ? null : formatMoney(snapshot.amount, 'USD')
  // A Design Plan fails on whichever window is exhausted, so the readout lists
  // every measurable window (5-hour + 7-day) instead of only the nearest-term
  // one. "剩" is spelled out because the bare percentage alone is ambiguous.
  const display = measured.length > 0
    ? measured
        .map((window) => `${window.label.replace('Design Plan · ', '')} 剩 ${window.remainingPct.toFixed(0)}%`)
        .join(' · ')
    : money ?? '已读取'

  const detail = [
    ...(money === null ? [] : [{ label: '钱包余额', value: money }]),
    ...(snapshot.tier === null ? [] : [{ label: '套餐', value: snapshot.tier.toUpperCase() }]),
    ...windows.map((window) => ({
      label: window.label,
      value: window.remainingPct === null
        ? (window.note ?? '接口未给出可读数值')
        : `剩 ${window.remainingPct.toFixed(0)}%`
          + (window.resetAt === undefined ? '' : ` · 重置于 ${window.resetAt}`),
    })),
  ]

  return {
    status: STATUS.OK,
    result: {
      kind: windows.length > 0 ? 'quota' : 'balance',
      currency: 'USD',
      amount: snapshot.amount,
      display,
      // A partial read is still a successful read, so the caveat travels as a
      // detail row: `message` belongs to failures, and the store clears it on
      // success — putting it there would silently drop the explanation.
      detail: snapshot.note === undefined ? detail : [...detail, { label: '说明', value: snapshot.note }],
      windows,
    },
    url,
    message: null,
    raw: null,
  }
}

/**
 * Parse the account snapshot `billing/preflight` returns.
 *
 * Verified live shape:
 *   { balanceUsd: "1.5000",
 *     codingPlan: { eligible: true, tier: "go",
 *                   windows: [{ policyId, durationSeconds, resetMode,
 *                               usedCredits, limitCredits, remainingCredits,
 *                               windowStart, resetsAt }] },
 *     funding: "wallet" }
 *
 * Returns null when neither a balance nor a plan block is present, so the
 * caller can report a parse failure instead of inventing a reading. A missing
 * balance is reported as `null`, never as 0: "$0.00" is a claim about the
 * account, and an absent field is not evidence for it.
 * @param {unknown} body
 * @returns {{ amount: number | null, tier: string | null, windows: object[] } | null}
 */
export function parsePreflight(body) {
  const root = body !== null && typeof body === 'object' ? body : {}
  const hasBalance = typeof root.balanceUsd === 'string' || typeof root.balanceUsd === 'number'
  const hasPlan = root.codingPlan !== null && typeof root.codingPlan === 'object'
  if (!hasBalance && !hasPlan) return null

  let amount = null
  if (hasBalance) {
    try {
      amount = parseWalletBalance({ balanceUsd: root.balanceUsd }).amount
    } catch {
      // A present-but-unreadable balance is a failure, not a zero.
      return null
    }
  }
  const plan = parseCodingPlanUsage(hasPlan ? root.codingPlan : {})
  return { amount, tier: plan.tier, windows: plan.windows }
}

/**
 * Resolve the workspace that owns this account's billing.
 * @param {object} input
 * @param {string} apiUrl
 * @param {Record<string, string>} headers
 * @param {number} timeoutMs
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<
 *   | { ok: true, workspaceId: string }
 *   | { ok: false, status: string, url: string, message: string, raw: string | null }
 * >}
 */
async function readWorkspace(input, apiUrl, headers, timeoutMs, signal) {
  const listUrl = `${apiUrl}/api/v1/workspaces`
  const list = await getJson(input.fetchImpl, listUrl, headers, timeoutMs, signal)
  if (!list.ok) {
    return {
      ok: false,
      status: list.status === 401 || list.status === 403
        ? STATUS.HTTP_ERROR
        : list.status === null
          ? STATUS.NETWORK_ERROR
          : STATUS.HTTP_ERROR,
      url: listUrl,
      message: list.status === 401 || list.status === 403
        ? `控制面不接受当前 controlKey 读取工作区列表（HTTP ${list.status}）。`
          + '该凭据可能已轮换：重新运行 `vela login` 即可刷新。'
        : `读取工作区列表失败（${list.status ?? '网络错误'}）。`,
      raw: list.raw,
    }
  }
  let workspace
  try {
    workspace = pickWorkspace(list.body)
  } catch (error) {
    return {
      ok: false,
      status: STATUS.PARSE_FAILED,
      url: listUrl,
      message: `工作区列表无法解析：${errorText(error)}`,
      raw: echo(list.raw),
    }
  }
  if (workspace === null) {
    return {
      ok: false,
      status: STATUS.PARSE_FAILED,
      url: listUrl,
      message: '该账号下没有任何工作区，无法定位钱包与套餐额度。',
      raw: echo(list.raw),
    }
  }
  return { ok: true, workspaceId: workspace.workspaceId }
}


/**
 * Perform one GET and classify the transport outcome.
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {number} timeoutMs
 * @param {AbortSignal | undefined} outerSignal
 * @returns {Promise<{ ok: boolean, status: number | null, body: unknown, raw: string, error: unknown }>}
 */
async function getJson(fetchImpl, url, headers, timeoutMs, outerSignal) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = outerSignal === undefined ? timeout : AbortSignal.any([outerSignal, timeout])
  // The same cold-connection reset measured on this host (1 in 4 fresh TLS
  // connections) is retried here, so a first read is not reported as a network
  // failure that then "fixes itself" on the next trigger.
  const attempt = await fetchWithRetry(fetchImpl, url, headers, signal)
  if (attempt.response === null) {
    return { ok: false, status: null, body: null, raw: '', error: attempt.error }
  }
  const response = attempt.response
  const raw = await response.text().catch(() => '')
  if (!response.ok) return { ok: false, status: response.status, body: null, raw, error: null }
  try {
    return { ok: true, status: response.status, body: JSON.parse(raw), raw, error: null }
  } catch (error) {
    return { ok: false, status: response.status, body: null, raw, error }
  }
}

/**
 * Explain a wallet read failure in terms the user can act on.
 * @param {{ status: number | null, error: unknown, raw: string }} wallet
 * @param {AmrLogin} login
 * @returns {string}
 */
function walletMessage(wallet, login) {
  if (wallet.status === 401 || wallet.status === 403) {
    return `控制面拒绝了 ${login.profile} 档案的 controlKey（HTTP ${wallet.status}）。`
      + '该凭据可能已轮换：重新运行 `vela login`，或重新登录 OpenDesign 桌面端即可刷新 '
      + `${login.configPath}。`
      + '（DSH 里的 sk-amr-… API Key 是推理用的 runtime key，官方不对它开放账单接口。）'
  }
  if (wallet.status === null) {
    return `连接 ${login.apiUrl} 失败：${errorText(wallet.error)}`
  }
  if (wallet.status === 404) {
    return `${login.apiUrl} 返回 404：钱包接口可能已改址。`
  }
  return `${login.apiUrl} 返回 HTTP ${wallet.status}。${wallet.raw === '' ? '' : `响应片段：${echo(wallet.raw)}`}`
}

/**
 * Truncate a response body for an error message.
 * @param {string} text
 * @returns {string}
 */
function echo(text) {
  const value = String(text ?? '')
  return value.length <= ECHO_LIMIT ? value : `${value.slice(0, ECHO_LIMIT)}…`
}

/**
 * Read a trimmed non-empty string.
 * @param {unknown} value
 * @returns {string | null}
 */
function textOf(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Extract a message from an unknown thrown value.
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return '请求超时'
    if (error.name === 'AbortError') return '请求已取消'
    return error.message
  }
  return String(error)
}

/**
 * Response parsers — one per catalog adapter, all pure.
 *
 * These were written from the documented response shapes without live access to
 * any of the eight vendors, so every parser is written to *fail loudly rather
 * than guess*. A parser returns a normalized result only when it finds the
 * figure it was looking for; anything else throws `ParseError`, which the
 * caller turns into the `parse-failed` status with the raw response echoed.
 * That is the whole point: a wrong number is worse than no number.
 */

/** Thrown when a 200 response does not contain a figure this parser trusts. */
export class ParseError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'ParseError'
  }
}

/**
 * @typedef {object} RawResult
 * @property {'balance' | 'quota'} kind
 * @property {string | null} currency
 * @property {number | null} amount      Remaining money for `balance`; null for `quota`.
 * @property {string} display            Short text for the header chip.
 * @property {{ label: string, value: string }[]} detail  Popover rows.
 * @property {{ key: string, label: string, used: number | null, limit: number | null, remainingPct: number | null, note?: string }[]} windows
 */

const CURRENCY_SYMBOLS = { CNY: '¥', RMB: '¥', USD: '$', EUR: '€', GBP: '£', JPY: '¥' }

/**
 * Coerce a value that may be a number or a numeric string.
 * @param {unknown} value
 * @returns {number | null}
 */
export function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Read a dotted path out of a nested object.
 * @param {unknown} root
 * @param {string} path e.g. `data.total_balance`
 * @returns {unknown}
 */
export function pick(root, path) {
  let node = root
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = node[key]
  }
  return node
}

/**
 * Return the first value among `paths` that coerces to a finite number.
 * @param {unknown} root
 * @param {string[]} paths
 * @returns {number | null}
 */
export function firstNum(root, paths) {
  for (const path of paths) {
    const value = num(pick(root, path))
    if (value !== null) return value
  }
  return null
}

/**
 * Return the first value among `paths` that is a non-empty string.
 * @param {unknown} root
 * @param {string[]} paths
 * @returns {string | null}
 */
export function firstString(root, paths) {
  for (const path of paths) {
    const value = pick(root, path)
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return null
}

/**
 * Find every nested object satisfying a predicate.
 * @param {unknown} root
 * @param {(node: Record<string, unknown>) => boolean} predicate
 * @param {number} [depth]
 * @returns {Record<string, unknown>[]}
 */
export function findObjects(root, predicate, depth = 6) {
  const found = []
  const seen = new Set()
  /** @param {unknown} node @param {number} level */
  function walk(node, level) {
    if (level > depth || node === null || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) walk(item, level + 1)
      return
    }
    if (predicate(node)) found.push(node)
    for (const value of Object.values(node)) walk(value, level + 1)
  }
  walk(root, 0)
  return found
}

/**
 * Format money for display, keeping the sign and two decimals.
 * @param {number} amount
 * @param {string | null} currency
 * @returns {string}
 */
export function formatMoney(amount, currency) {
  const code = typeof currency === 'string' && currency !== '' ? currency.toUpperCase() : null
  const symbol = code === null ? '' : CURRENCY_SYMBOLS[code] ?? `${code} `
  return `${symbol}${amount.toFixed(2)}`
}

/**
 * Build a money result.
 * @param {number} amount @param {string | null} currency
 * @param {{ label: string, value: string }[]} [detail]
 * @returns {RawResult}
 */
function money(amount, currency, detail = []) {
  const code = typeof currency === 'string' && currency !== '' ? currency.toUpperCase() : null
  return {
    kind: 'balance',
    currency: code,
    amount,
    display: formatMoney(amount, code),
    detail: [{ label: '剩余', value: formatMoney(amount, code) }, ...detail],
    windows: [],
  }
}

/**
 * Normalize one quota window, preferring an explicit used/limit pair over a
 * bare percentage — a lone `percentage` field does not say which direction it
 * measures, so it is reported as "已用" rather than silently inverted.
 * @param {{ key: string, label: string, used?: number | null, limit?: number | null, percentage?: number | null, resetAt?: string | null }} input
 * @returns {RawResult['windows'][number]}
 */
function window_(input) {
  const used = num(input.used)
  const limit = num(input.limit)
  const percentage = num(input.percentage)
  /** @type {number | null} */
  let remainingPct = null
  let note = undefined
  if (used !== null && limit !== null && limit > 0) {
    remainingPct = Math.max(0, Math.min(100, (1 - used / limit) * 100))
  } else if (percentage !== null) {
    note = `接口返回占比 ${percentage}%（方向未标注，按已用理解）`
  }
  return {
    key: input.key,
    label: input.label,
    used,
    limit,
    remainingPct,
    ...(note === undefined ? {} : { note }),
    ...(typeof input.resetAt === 'string' && input.resetAt !== '' ? { resetAt: input.resetAt } : {}),
  }
}

/**
 * Build a quota result from normalized windows.
 *
 * The readout shows the shortest-span window that actually carries a figure;
 * `windows` keeps the vendor's own order so the popover lists them as the API
 * returned them.
 * @param {RawResult['windows']} windows
 * @param {{ label: string, value: string }[]} [detail]
 * @returns {RawResult}
 */
function quota(windows, detail = []) {
  if (windows.length === 0) throw new ParseError('响应里没有可识别的额度窗口')
  const measurable = windows.filter((w) => w.remainingPct !== null)
  // A plan with two windows (5-hour + weekly) fails on whichever window runs out
  // first, so the readout lists every measurable window instead of only the
  // shortest span. "剩" is spelled out because a bare "5 小时 100%" is ambiguous
  // about which direction it measures.
  const display =
    measurable.length > 0
      ? measurable
          .map((w) => `${compactWindowLabel(w.label)} 剩 ${w.remainingPct.toFixed(0)}%`)
          .join(' · ')
      : windows[0].label
  return {
    kind: 'quota',
    currency: null,
    amount: null,
    display,
    detail: [
      ...windows.map((w) => ({ label: w.label, value: describeWindow(w) })),
      ...detail,
    ],
    windows,
  }
}

/**
 * Render one quota window as a single line.
 *
 * When the vendor reported a bare percentage, the raw figure is kept alongside
 * the derived remaining figure — so a reading built on an assumption about
 * which direction the vendor's percentage runs stays auditable.
 * @param {RawResult['windows'][number]} w
 * @returns {string}
 */
export function describeWindow(w) {
  const parts = []
  if (w.used !== null && w.limit !== null) {
    const pct = w.remainingPct === null ? '?' : w.remainingPct.toFixed(0)
    parts.push(`已用 ${w.used} / ${w.limit}（剩 ${pct}%）`)
  } else if (w.remainingPct !== null) {
    parts.push(`剩 ${w.remainingPct.toFixed(0)}%`)
  }
  if (w.note !== undefined) parts.push(w.note)
  if (parts.length === 0) parts.push('接口未给出可读数值')
  if (typeof w.resetAt === 'string' && w.resetAt !== '') parts.push(`重置于 ${w.resetAt}`)
  return parts.join(' · ')
}

/**
 * Parse a vendor response body.
 * @param {string} adapter Catalog `adapter` name.
 * @param {unknown} body Parsed JSON.
 * @returns {RawResult}
 */
export function parseResponse(adapter, body) {
  const parser = PARSERS[adapter]
  if (parser === undefined) throw new ParseError(`没有为适配器 ${adapter} 注册解析器`)
  return parser(body)
}

/** @type {Record<string, (body: unknown) => RawResult>} */
const PARSERS = {
  /** `GET /user/balance` → `{is_available, balance_infos:[{currency,total_balance,…}]}` */
  deepseek(body) {
    const infos = pick(body, 'balance_infos')
    if (!Array.isArray(infos) || infos.length === 0) {
      throw new ParseError('响应缺少 balance_infos 数组')
    }
    const usable = infos.filter((info) => num(pick(info, 'total_balance')) !== null)
    if (usable.length === 0) throw new ParseError('balance_infos 里没有可读的 total_balance')
    // One entry per currency; sum only same-currency entries and report the
    // first currency, rather than adding unlike currencies together.
    const currency = firstString(usable[0], ['currency'])
    const total = usable
      .filter((info) => firstString(info, ['currency']) === currency)
      .reduce((sum, info) => sum + (num(pick(info, 'total_balance')) ?? 0), 0)
    const detail = usable.map((info) => ({
      label: firstString(info, ['currency']) ?? '余额',
      value: formatMoney(num(pick(info, 'total_balance')) ?? 0, firstString(info, ['currency'])),
    }))
    return money(total, currency, detail)
  },

  /** `GET /api/v1/key` → `{data:{limit, usage, limit_remaining}}` */
  openrouter(body) {
    const remaining = firstNum(body, ['data.limit_remaining', 'limit_remaining'])
    const limit = firstNum(body, ['data.limit', 'limit'])
    const used = firstNum(body, ['data.usage', 'usage'])
    if (remaining === null) {
      // A null limit_remaining means an unlimited key, which is a real answer
      // and must not be reported as a parse failure.
      if (limit === null && used === null) throw new ParseError('响应缺少 limit_remaining / limit / usage')
      return {
        kind: 'balance',
        currency: 'USD',
        amount: null,
        display: '无限额',
        detail: [
          { label: '剩余', value: '无限额（Key 未设上限）' },
          ...(used === null ? [] : [{ label: '已用', value: formatMoney(used, 'USD') }]),
        ],
        windows: [],
      }
    }
    const detail = [
      ...(limit === null ? [] : [{ label: 'Key 上限', value: formatMoney(limit, 'USD') }]),
      ...(used === null ? [] : [{ label: '已用', value: formatMoney(used, 'USD') }]),
    ]
    return money(remaining, 'USD', detail)
  },

  /** `GET /v1/users/me/balance` → `{data:{available_balance,…}}` */
  moonshot(body) {
    const available = firstNum(body, [
      'data.available_balance',
      'data.availableBalance',
      'available_balance',
    ])
    if (available === null) throw new ParseError('响应缺少 data.available_balance')
    const voucher = firstNum(body, ['data.voucher_balance', 'data.voucherBalance'])
    const cash = firstNum(body, ['data.cash_balance', 'data.cashBalance'])
    const detail = [
      ...(cash === null ? [] : [{ label: '现金', value: formatMoney(cash, 'CNY') }]),
      ...(voucher === null ? [] : [{ label: '代金券', value: formatMoney(voucher, 'CNY') }]),
    ]
    return money(available, 'CNY', detail)
  },

  /** `GET /v1/user/info` → `{data:{balance, chargeBalance, totalBalance}}` */
  siliconflow(body) {
    const total = firstNum(body, ['data.totalBalance', 'data.balance'])
    if (total === null) throw new ParseError('响应缺少 data.totalBalance / data.balance')
    const charge = firstNum(body, ['data.chargeBalance'])
    const detail = charge === null ? [] : [{ label: '充值余额', value: formatMoney(charge, 'CNY') }]
    return money(total, 'CNY', detail)
  },

  /**
   * `GET /api/monitor/usage/quota/limit` — subscription windows.
   *
   * Shape verified live (2026-10-27):
   *   data.limits[] = {
   *     type: 'TOKENS_LIMIT' | 'TIME_LIMIT',
   *     unit: 3 (小时) | 5 (月) | 6 (周), number, percentage,
   *     nextResetTime (epoch ms), usage/currentValue/remaining (TIME_LIMIT only)
   *   }
   * `percentage` is the *used* share. A GLM/Z.ai Coding Plan fails on whichever
   * window is exhausted, so both token windows are kept; the monthly tool-call
   * allowance (search / web-reader / zread) is reported as extra detail, since
   * it cannot block model traffic.
   */
  zhipu(body) {
    const listed = pick(body, 'data.limits')
    // The live GLM Coding Plan shape names windows with a numeric unit code and
    // a type. Other deployments return window-shaped objects without them, so
    // only the unit/type shape gets the code mapping and the used→remaining
    // inversion; anything else keeps the conservative "unlabelled percentage"
    // treatment and the generic span labels.
    const live = Array.isArray(listed) && listed.some((node) => {
      if (node === null || typeof node !== 'object') return false
      const type = String(node.type ?? '').toUpperCase()
      return num(node.unit) !== null || type === 'TOKENS_LIMIT' || type === 'TIME_LIMIT'
    })
    if (!live) {
      const candidates = Array.isArray(listed)
        ? listed
        : findObjects(body, (node) => {
            const hasPair = num(node.used) !== null && num(node.limit) !== null
            const hasPct = num(node.percentage) !== null || num(node.used_percent) !== null
            return hasPair || hasPct
          })
      if (!Array.isArray(candidates) || candidates.length === 0) throw new ParseError('响应里没有可识别的额度对象')
      const windows = candidates.map((node, index) => {
        const hours = num(node.number) ?? num(node.duration) ?? num(node.period)
        const unit = firstString(node, ['unit', 'type', 'name'])
        return window_({
          key: `w${index}`,
          label: labelForWindow({ hours, unit, index }),
          used: num(node.used) ?? num(node.used_tokens),
          limit: num(node.limit) ?? num(node.total) ?? num(node.limit_tokens),
          percentage: num(node.percentage) ?? num(node.used_percent),
          resetAt: firstString(node, ['resetAt', 'reset_at', 'resetTime', 'nextResetTime']),
        })
      })
      return quota(dedupeWindows(windows))
    }
    const windows = []
    const detail = []
    for (const [index, node] of listed.entries()) {
      if (node === null || typeof node !== 'object') continue
      const type = String(firstString(node, ['type']) ?? '').toUpperCase()
      const percentage = num(node.percentage) ?? num(node.used_percent)
      const resetAt = epochToIso(num(node.nextResetTime))
        ?? firstString(node, ['resetAt', 'reset_at', 'resetTime'])
        ?? undefined
      if (type === 'TIME_LIMIT') {
        const used = num(node.currentValue) ?? num(node.usage)
        const limit = num(node.usage) ?? (num(node.remaining) !== null && used !== null ? used + num(node.remaining) : null)
        const share = percentage !== null
          ? percentage
          : (limit !== null && used !== null && limit > 0 ? (used / limit) * 100 : null)
        detail.push({
          label: '工具调用额度（月）',
          value: share === null ? '接口未给出可读数值' : `已用 ${share.toFixed(0)}%`,
        })
        continue
      }
      const window = window_({
        key: `w${index}`,
        label: zhipuWindowLabel(num(node.unit), num(node.number)),
        used: num(node.used) ?? num(node.used_tokens),
        limit: num(node.limit) ?? num(node.total) ?? num(node.limit_tokens),
        percentage,
        resetAt,
      })
      // The vendor reports the used share; invert it so every window is stored
      // as "remaining", which is what the chip compares across windows.
      if (window.remainingPct === null && percentage !== null) {
        window.remainingPct = clampPct(100 - percentage)
        window.note = `接口返回已用占比 ${percentage}%（方向按已用理解）`
      }
      windows.push(window)
    }
    if (windows.length === 0) throw new ParseError('响应里没有可识别的 token 额度窗口')
    return quota(dedupeWindows(windows), detail)
  },

  /** `GET /coding/v1/usages` — subscription windows (5h / weekly). */
  kimiCoding(body) {
    const rows = Array.isArray(pick(body, 'data'))
      ? pick(body, 'data')
      : findObjects(body, (node) => num(node.used) !== null || num(node.usage) !== null)
    if (!Array.isArray(rows) || rows.length === 0) throw new ParseError('响应里没有额度窗口数组')
    const windows = rows.map((node, index) =>
      window_({
        key: `w${index}`,
        label: firstString(node, ['window', 'period', 'name', 'label']) ?? `窗口 ${index + 1}`,
        used: num(pick(node, 'used')) ?? num(pick(node, 'usage')),
        limit: num(pick(node, 'limit')) ?? num(pick(node, 'total')),
        percentage: num(pick(node, 'percentage')),
        resetAt: firstString(node, ['resetAt', 'reset_at', 'resetTime']),
      }),
    )
    return quota(dedupeWindows(windows))
  },

  /** `GET /v1/token_plan/remains` — subscription plan. */
  minimax(body) {
    const nodes = findObjects(
      body,
      (node) => num(node.remaining) !== null || num(node.remains) !== null || num(node.left) !== null,
    )
    if (nodes.length === 0) throw new ParseError('响应里没有可识别的剩余额度字段')
    const detail = nodes.map((node) => {
      const label = firstString(node, ['name', 'model', 'plan', 'type']) ?? '套餐'
      const value = num(node.remaining) ?? num(node.remains) ?? num(node.left) ?? 0
      const total = num(node.total) ?? num(node.limit)
      return { label, value: total === null ? String(value) : `${value} / ${total}` }
    })
    const head = num(nodes[0].remaining) ?? num(nodes[0].remains) ?? num(nodes[0].left) ?? 0
    const headTotal = num(nodes[0].total) ?? num(nodes[0].limit)
    return {
      kind: 'quota',
      currency: null,
      amount: null,
      display: headTotal === null ? String(head) : `${head}/${headTotal}`,
      detail,
      windows: dedupeWindows(
        nodes.map((node, index) =>
          window_({
            key: `w${index}`,
            label: firstString(node, ['name', 'model', 'plan', 'type']) ?? `套餐 ${index + 1}`,
            used:
              num(node.used) ??
              (num(node.total) !== null && num(node.remaining) !== null
                ? num(node.total) - num(node.remaining)
                : null),
            limit: num(node.total) ?? num(node.limit),
            percentage: num(node.percentage),
          }),
        ),
      ),
    }
  },

  /**
   * `GET /zen/go/v1/usage` — rolling / weekly / monthly windows.
   *
   * Verified against a live response:
   *   {"usage":{"rolling":{"status":"ok","percent":0,"resetsAt":"…"},
   *             "weekly":{"status":"ok","percent":8,"resetsAt":"…"},
   *             "monthly":{"status":"ok","percent":53,"resetsAt":"…"}}}
   *
   * `percent` is a USED share, not a remaining one. That is inferable rather
   * than assumed: a live account read `rolling: 0` while actively completing
   * turns, which cannot mean "0% remaining". The derived remaining is shown,
   * and the raw figure is stated in the window note so the reading is
   * auditable if this vendor ever flips the convention.
   */
  opencodeGo(body) {
    const usage = pick(body, 'usage')
    const windows = []
    if (usage !== null && typeof usage === 'object' && !Array.isArray(usage)) {
      for (const [key, node] of Object.entries(usage)) {
        if (node === null || typeof node !== 'object') continue
        const percent = num(node.percent)
        if (percent === null) continue
        const remaining = clampPct(100 - percent)
        windows.push({
          key,
          label: WINDOW_LABELS[key] ?? key,
          used: null,
          limit: null,
          remainingPct: remaining,
          note: `原始 percent=${percent}`,
          ...(firstString(node, ['resetsAt', 'resetAt', 'reset_at']) === null
            ? {}
            : { resetAt: firstString(node, ['resetsAt', 'resetAt', 'reset_at']) }),
        })
      }
      if (windows.length > 0) return quota(windows)
    }

    // Fall back to the generic scan for a shape this parser has not seen.
    const nodes = findObjects(body, (node) => {
      const hasPair = num(node.used) !== null && num(node.limit) !== null
      const hasPct = num(node.percentage) !== null || num(node.used_percent) !== null
      const hasWindow = typeof node.window === 'string' || typeof node.period === 'string'
      return hasPair || hasPct || (hasWindow && num(node.remaining) !== null)
    })
    if (nodes.length === 0) throw new ParseError('响应里没有可识别的额度窗口')
    return quota(dedupeWindows(nodes.map((node, index) =>
      window_({
        key: `w${index}`,
        label: firstString(node, ['window', 'period', 'name', 'label']) ?? `窗口 ${index + 1}`,
        used: num(node.used) ?? num(node.usage),
        limit: num(node.limit) ?? num(node.total),
        percentage: num(node.percentage) ?? num(node.used_percent),
        resetAt: firstString(node, ['resetAt', 'reset_at', 'resetTime', 'resetsAt']),
      }),
    )))
  },
}

/**
 * Clamp a percentage into 0..100.
 * @param {number} value
 * @returns {number}
 */
export function clampPct(value) {
  return Math.max(0, Math.min(100, value))
}

/**
 * Map a vendor's window key to a readable label.
 * @param {string} key
 * @returns {string}
 */
const WINDOW_LABELS = {
  rolling: '5 小时',
  weekly: '每周',
  monthly: '每月',
}

/**
 * Order quota windows by how soon each one can block you: the shortest span
 * first.
 *
 * The readout shows the *near-term* window rather than the one with the least
 * left, because a subscription is managed against its tightest cycle — knowing
 * the 5-hour window and the weekly one are both comfortable is more useful than
 * watching a monthly figure that cannot bind for weeks. Every window is still
 * listed in the detail popover.
 *
 * Matched against a window's key or label, so it works whichever name a vendor
 * chose. Unrecognised windows sort last rather than competing with named ones.
 */
const SPAN_RANKS = [
  [/(roll|hour|hourly|session|\b5\s*h)/i, 1],
  [/(daily|\bday\b|\b24\s*h)/i, 2],
  [/(week|weekly|\b7\s*d)/i, 3],
  [/(month|monthly|\b30\s*d)/i, 4],
]

/** Chinese span words, checked separately because they are not word-bounded. */
const SPAN_RANKS_CJK = [
  [/滚动|小时/, 1],
  [/每日|当天/, 2],
  [/每周|周额度/, 3],
  [/每月|月额度/, 4],
]

/**
 * Rank a window by its span, shortest first.
 * @param {{ key?: string, label?: string }} window
 * @returns {number} 1..4 for a recognised span, 5 for an unrecognised one.
 */
export function spanRank(window) {
  const haystack = `${window?.key ?? ''} ${window?.label ?? ''}`
  for (const [pattern, rank] of SPAN_RANKS) {
    if (pattern.test(haystack)) return rank
  }
  for (const [pattern, rank] of SPAN_RANKS_CJK) {
    if (pattern.test(haystack)) return rank
  }
  return 5
}

/**
 * Derive a readable label for a window whose shape did not name itself.
 * @param {{ hours: number | null, unit: string | null, index: number }} input
 * @returns {string}
 */
function labelForWindow({ hours, unit, index }) {
  if (hours !== null) return `${hours} 小时窗口`
  if (unit !== null && unit !== '') return unit
  return `窗口 ${index + 1}`
}

/**
 * Compact a window label for the one-line readout.
 * "Design Plan · 5 小时" → "5 小时"; other labels pass through unchanged.
 * @param {string} label
 * @returns {string}
 */
function compactWindowLabel(label) {
  return String(label ?? '').replace(/^Design Plan ·\s*/u, '').trim()
}

/**
 * Label one Zhipu `limits[]` entry. The live shape names codes, not spans
 * (3 = 小时, 5 = 月, 6 = 周), so map the code rather than guessing hours.
 * @param {number | null} unit
 * @param {number | null} number
 * @returns {string}
 */
function zhipuWindowLabel(unit, number) {
  if (unit === 3) return number === null ? '小时窗口' : `${number} 小时`
  if (unit === 4) return '每日'
  if (unit === 5) return '每月'
  if (unit === 6) return '每周'
  return number === null ? '额度窗口' : `${number} 窗口`
}

/**
 * Convert an epoch-millisecond reset field to an ISO string.
 * @param {number | null} value
 * @returns {string | null}
 */
function epochToIso(value) {
  const ms = num(value)
  if (ms === null || ms <= 0) return null
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Drop windows that describe the same thing, so a shape that nests the same
 * quota twice does not render it twice.
 * @param {RawResult['windows']} windows
 * @returns {RawResult['windows']}
 */
function dedupeWindows(windows) {
  const byLabel = new Map()
  for (const w of windows) {
    const key = `${w.label}|${w.used}|${w.limit}|${w.remainingPct}`
    if (!byLabel.has(key)) byLabel.set(key, w)
  }
  return [...byLabel.values()]
}

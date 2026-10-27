/**
 * Browser-half render tests.
 *
 * The client bundle is a classic script that registers itself through
 * `window.__ModuleLoader__.load()`, so it cannot be imported directly. This file
 * installs a minimal `window` and a minimal React, lets the real bundle
 * register, and then *renders* the readout across its states.
 *
 * Why render instead of only lint: a use-before-declaration bug in the component
 * body (a `const` referenced by a hook call declared above it) is a temporal dead
 * zone error. It passes `node --check`, passes the contract check, and still
 * throws at render time — which is exactly how the readout once vanished from
 * the composer entirely. Only running the component catches it.
 *
 * The React stub keeps hooks faithful enough for that purpose: `useState`
 * returns its initial value, `useMemo`/`useCallback` evaluate eagerly, and
 * `createElement` records a plain tree that the helper below can walk — including
 * invoking function components the way React would.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { before, describe, it } from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_PATH = join(HERE, '..', 'client', 'client.js')

/** The slot component, captured from the bundle's factory. */
let BalanceReadout = null
/** The React stub, so a test can seed the next render's state. */
let stubReact = null

/**
 * Minimal React, faithful on the points the component depends on.
 *
 * `useState` is the seam the tests use to inject a snapshot: the readout's state
 * is seeded from its initial value, so `makeReact` accepts an initial-state
 * override list rather than the component needing a test-only prop. That keeps
 * the shipping bundle free of injection hooks.
 */
function makeReact() {
  /** Values `useState` should return instead of the declared initial value. */
  let seed = null
  let index = 0
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: Symbol('Fragment'),
    useState: (init) => {
      const initial = typeof init === 'function' ? init() : init
      if (seed !== null && index < seed.length) {
        const forced = seed[index]
        index += 1
        return [forced === undefined ? initial : forced, () => {}]
      }
      index += 1
      return [initial, () => {}]
    },
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (factory) => factory,
    useRef: (value) => ({ current: value }),
    // The readout only uses this for the model directory, which the slot hands
    // in as null in these tests.
    useSyncExternalStore: (_subscribe, read) => read(),
    /**
     * Seed the next render's `useState` calls, in call order.
     * @param {(unknown | undefined)[] | null} values
     */
    __seed(values) {
      seed = values
      index = 0
    },
  }
}

before(() => {
  // A `window` with the loader the bundle expects; `factory` runs immediately so
  // the component closes over the stub React it was written against.
  const modules = []
  const listeners = []
  globalThis.window = {
    __ModuleLoader__: {
      load: (definition) => {
        modules.push(definition)
      },
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener: (name, fn) => listeners.push([name, fn]),
    removeEventListener: () => {},
  }
  globalThis.document = {
    head: { appendChild() {}, removeChild() {} },
    createElement: () => ({ setAttribute() {}, style: {}, appendChild() {} }),
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible',
    querySelector: () => null,
    querySelectorAll: () => [],
  }
  globalThis.fetch = async () => {
    throw new Error('the render tests never touch the network')
  }

  const source = readFileSync(CLIENT_PATH, 'utf8')
  // Execute the bundle as the loader would: a classic script with one global.
  const run = new Function('window', 'document', 'fetch', source)
  run(globalThis.window, globalThis.document, globalThis.fetch)

  assert.equal(modules.length, 1, 'the bundle must register exactly one module')
  const definition = modules[0]
  assert.equal(definition.id, '@zhujiuyi/dsh-balance')

  const stubReact2 = makeReact()
  stubReact = stubReact2
  const module = definition.factory((specifier) => {
    if (specifier === 'react') return stubReact2
    throw new Error(`unexpected require: ${specifier}`)
  })

  assert.equal(typeof module.apply, 'function', 'the module must expose apply()')

  // Reach the component through the slot registration instead of a private name:
  // `apply()` registers it, so whichever function it hands to the slot is the one
  // the runtime renders.
  const slots = []
  const ctx = {
    inject(names, callback) {
      // Provide only what the registrations need, so optional paths stay out.
      if (names.includes('slots') || names.includes('configForms') || names.includes('locale')) return () => {}
      return () => {}
    },
    effect(body) {
      const disposer = typeof body === 'function' ? body() : undefined
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    on: () => () => {},
    locale: { register: () => () => {} },
    slots: {
      inject: (_name, register) => register(),
      register: (definition_, component) => {
        slots.push({ definition: definition_, component })
        return () => {}
      },
    },
  }
  // `apply` reaches for ctx.slots / ctx.locale directly, and wraps optional
  // services in ctx.inject; this stub covers both shapes.
  module.apply(ctx)
  const readout = slots.find((row) => row.definition.name === 'conversation.composer.dock')
  assert.ok(readout !== undefined, 'the readout must be registered on the composer dock')
  BalanceReadout = readout.component
  assert.equal(typeof BalanceReadout, 'function')
})

/** A route row shaped like the host's `describeRoute`. */
function route(overrides = {}) {
  return {
    key: 'opendesign',
    id: 'opendesign',
    label: 'OpenDesign (AMR)',
    billing: 'subscription',
    apiKeyEnv: null,
    controlPlane: true,
    source: 'id',
    endpoint: null,
    note: '',
    catalogued: true,
    ...overrides,
  }
}

/** A quota state carrying the given windows. */
function quotaState(windows, overrides = {}) {
  return {
    key: 'opendesign',
    status: 'ok',
    url: 'https://amr-api.open-design.ai/api/v1/workspaces/x/billing/preflight',
    message: null,
    raw: null,
    queriedAt: Date.now(),
    value: '5 小时 剩 92%',
    stale: false,
    result: { kind: 'quota', currency: 'USD', amount: 1.5, display: '5 小时 剩 92%', detail: [], windows },
    ...overrides,
  }
}

/** Collect every class name in a rendered tree, invoking function components. */
function classesOf(tree) {
  const found = new Set()
  const seen = new Set()
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (typeof node.type === 'function') {
      // React would mount it; do the same so its subtree is visible here.
      walk(node.type(node.props))
      return
    }
    if (typeof node.type === 'string' && node.props !== undefined && typeof node.props.className === 'string') {
      for (const name of node.props.className.split(/\s+/)) if (name !== '') found.add(name)
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  return found
}

/**
 * Collect every element node whose className contains `name`, invoking function
 * components the way `classesOf` does.
 * @param {unknown} tree
 * @param {string} name
 * @returns {{ type: string, props: Record<string, unknown>, children: unknown[] }[]}
 */
function nodesByClass(tree, name) {
  const found = []
  const seen = new Set()
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (typeof node.type === 'function') {
      walk(node.type(node.props))
      return
    }
    if (typeof node.type === 'string' && node.props !== undefined
      && typeof node.props.className === 'string'
      && node.props.className.split(/\s+/).includes(name)) {
      found.push(node)
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  return found
}

/**
 * Render the readout with a snapshot as a poll would leave it.
 *
 * The readout's `useState` calls happen in a fixed order — snapshot, error,
 * busy, open, scanning — so seeding that sequence reproduces exactly the state a
 * live poll produces without a network round trip, and without the shipping
 * bundle carrying a test-only prop.
 * @param {object | null} snapshot
 * @param {{ open?: boolean, busy?: boolean, error?: string | null }} [state]
 */
function render(snapshot, state = {}) {
  stubReact.__seed([
    snapshot,
    state.error ?? null,
    state.busy === true,
    state.open === true,
    false,
  ])
  return BalanceReadout({ t: (key) => key, sessionId: undefined, directories: null })
}

describe('browser half — render', () => {
  it('registers a readout component', () => {
    assert.equal(typeof BalanceReadout, 'function')
  })

  it('renders the collapsed chip before any snapshot arrives', () => {
    const classes = classesOf(render(null))
    assert.ok(classes.has('dsh-balance-anchor'))
    assert.ok(classes.has('dsh-balance-chip'))
    assert.ok(classes.has('dsh-balance-dot'))
    assert.ok(!classes.has('dsh-balance-pop'), 'the panel must stay closed')
  })

  it('shows both the 5-hour and weekly shares on the chip, coloured by window kind', () => {
    // A plan fails on whichever window is exhausted, so a 100% 5-hour window
    // next to an empty weekly one must not read as "everything is fine".
    const snapshot = {
      routes: [route()],
      states: [quotaState([
        { key: 'w5h', label: 'Design Plan · 5 小时', used: 0, limit: 100, remainingPct: 100 },
        { key: 'w7d', label: 'Design Plan · 7 天', used: 100, limit: 100, remainingPct: 0 },
      ])],
      history: {},
    }
    const tree = render(snapshot)
    const textOf = (node) => (node.children ?? []).flat(Infinity).join('')
    const labels = nodesByClass(tree, 'dsh-balance-wlabel')
    assert.deepEqual(labels.map(textOf), ['5小时', '周'])
    assert.deepEqual(labels.map((node) => node.props['data-kind']), ['time', 'week'])
    // The exhausted window is flagged so the stylesheet can paint its label red.
    assert.equal(labels[1].props['data-empty'], 'true')
    assert.equal(labels[0].props['data-empty'], 'false')
    const numbers = nodesByClass(tree, 'dsh-balance-wpct').map(textOf)
    assert.deepEqual(numbers, [' 100%', ' 0%'])
  })

  it('renders the panel shell when opened with no reading yet', () => {
    const classes = classesOf(render({ routes: [], states: [], history: {} }, { open: true }))
    assert.ok(classes.has('dsh-balance-pop'))
    assert.ok(classes.has('dsh-balance-head'))
    assert.ok(classes.has('dsh-balance-foot'))
  })

  it('renders the gauge, the windows and the trend for a quota reading', () => {
    const snapshot = {
      routes: [route()],
      states: [quotaState([
        { key: 'w5h', label: 'Design Plan · 5 小时', used: 8, limit: 100, remainingPct: 92, resetAt: new Date(Date.now() + 3_600_000).toISOString() },
        { key: 'w7d', label: 'Design Plan · 7 天', used: 3, limit: 100, remainingPct: 97 },
      ])],
      history: { opendesign: [{ key: 'w5h', points: [{ at: 1, pct: 95 }, { at: 2, pct: 92 }] }] },
      autoRefresh: true,
      minIntervalSec: 30,
      catalogSize: 9,
      known: 1,
    }
    const classes = classesOf(render(snapshot, { open: true }))
    // The gauge only exists when a window reports a share.
    assert.ok(classes.has('dsh-balance-gauge'), 'the ring gauge must render')
    assert.ok(classes.has('dsh-balance-gauge-arc'))
    assert.ok(classes.has('dsh-balance-win'), 'each window must render')
    assert.ok(classes.has('dsh-balance-bar'))
    assert.ok(classes.has('dsh-balance-bar-fill'))
    assert.ok(classes.has('dsh-balance-trend'), 'the trend must render with history')
    assert.ok(classes.has('dsh-balance-trend-line'))
    assert.ok(classes.has('dsh-balance-meta'))
  })

  it('says it is collecting instead of drawing a trend with one sample', () => {
    const snapshot = {
      routes: [route()],
      states: [quotaState([{ key: 'w5h', label: 'Design Plan · 5 小时', used: 1, limit: 2, remainingPct: 50 }])],
      history: { opendesign: [{ key: 'w5h', points: [{ at: 1, pct: 50 }] }] },
      autoRefresh: true,
      minIntervalSec: 30,
      catalogSize: 9,
      known: 1,
    }
    const classes = classesOf(render(snapshot, { open: true }))
    assert.ok(classes.has('dsh-balance-trend-empty'), 'one sample is not a trend')
    assert.ok(!classes.has('dsh-balance-trend-line'))
  })

  it('draws no gauge and no bar for a balance-only reading', () => {
    const snapshot = {
      routes: [route({ key: 'deepseek', id: 'deepseek', label: 'DeepSeek', billing: 'api', apiKeyEnv: 'DEEPSEEK_API_KEY', controlPlane: false })],
      states: [{
        key: 'deepseek',
        status: 'ok',
        url: 'https://api.deepseek.com/user/balance',
        message: null,
        raw: null,
        queriedAt: Date.now(),
        value: '$1.50',
        stale: false,
        result: { kind: 'balance', currency: 'USD', amount: 1.5, display: '$1.50', detail: [], windows: [] },
      }],
      history: { deepseek: [] },
      autoRefresh: true,
      minIntervalSec: 30,
      catalogSize: 9,
      known: 1,
    }
    const classes = classesOf(render(snapshot, { open: true }))
    assert.ok(classes.has('dsh-balance-hero'), 'the money figure still needs a hero')
    assert.ok(!classes.has('dsh-balance-gauge'), 'no share means no gauge')
    assert.ok(!classes.has('dsh-balance-win'), 'no windows means no rows')
  })

  it('keeps a window without a readable share, and draws no bar for it', () => {
    const snapshot = {
      routes: [route()],
      states: [quotaState([
        { key: 'ok-one', label: 'Design Plan · 5 小时', used: 1, limit: 2, remainingPct: 50 },
        { key: 'bad-one', label: 'Design Plan · 未知', used: null, limit: null, remainingPct: null, note: '接口未给出可读数值' },
      ])],
      history: {},
      autoRefresh: true,
      minIntervalSec: 30,
      catalogSize: 9,
      known: 1,
    }
    const classes = classesOf(render(snapshot, { open: true }))
    assert.ok(classes.has('dsh-balance-win'))
    // Exactly one bar: the readable window. The unreadable one must not get a
    // zero-width bar, which would read as "exhausted".
    assert.ok(classes.has('dsh-balance-bar-fill'))
  })

  it('renders a stale failure with its message and raw echo', () => {
    const snapshot = {
      routes: [route()],
      states: [quotaState(
        [{ key: 'w', label: 'Design Plan · 5 小时', used: 1, limit: 2, remainingPct: 50 }],
        { status: 'http-error', message: 'HTTP 401', raw: '{"error":"unauthenticated"}', stale: true },
      )],
      history: {},
      autoRefresh: false,
      minIntervalSec: 30,
      catalogSize: 9,
      known: 1,
    }
    const classes = classesOf(render(snapshot, { open: true }))
    assert.ok(classes.has('dsh-balance-msg'))
    assert.ok(classes.has('dsh-balance-raw'))
  })

  it('renders a transport error without throwing', () => {
    const classes = classesOf(render(null, { open: true, error: 'HTTP 500' }))
    assert.ok(classes.has('dsh-balance-pop'))
    assert.ok(classes.has('dsh-balance-msg'))
  })

  it('renders the busy state without throwing', () => {
    const snapshot = {
      routes: [route()],
      states: [quotaState([{ key: 'w', label: 'Design Plan · 5 小时', used: 1, limit: 2, remainingPct: 50 }])],
      history: {},
      autoRefresh: true,
      minIntervalSec: 30,
      catalogSize: 9,
      known: 1,
    }
    const classes = classesOf(render(snapshot, { open: true, busy: true }))
    // The refresh control stays mounted while busy; it is disabled rather than
    // removed, so the footer does not jump.
    assert.ok(classes.has('dsh-balance-refresh'))
  })
})

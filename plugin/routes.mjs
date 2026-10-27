/**
 * Route discovery — pure. The caller supplies the already-read inputs, so this
 * module never touches `ctx`, the filesystem, or the network.
 *
 * Sources, in descending precedence for each field:
 *   1. the user's `routes[]` override in this plugin's own config
 *   2. the provider metadata `ctx.llm.listProviders()` returns
 *   3. the composed config of the profile's `llm-*` Loader rows
 *      (`configEditor.configuration()`), which carries `baseURL` and `apiKeyEnv`
 *      for adapters that do not surface them through `listProviders()`
 *   4. the built-in catalog's default for that vendor
 */

import { ALLOWED_HOSTS, findById, matchRoute } from './catalog.mjs'

/**
 * @typedef {object} RouteInfo
 * @property {string} id                 Provider id as DSH knows it.
 * @property {string} label              Display name.
 * @property {string | null} baseURL     Gateway base URL, when known.
 * @property {string | null} apiKeyEnv   Credential variable name, when known.
 * @property {string | null} endpoint    Custom endpoint template, when the user set one.
 * @property {import('./catalog.mjs').CatalogEntry | undefined} entry  Catalog match.
 * @property {string} source             Where the identifying fields came from.
 * @property {boolean} catalogued        False when the route is not in the catalog at all.
 */

/**
 * Read a string field without throwing on odd shapes.
 * @param {unknown} value
 * @returns {string | null}
 */
function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Collect `{ baseURL, apiKeyEnv }` for every provider named in the profile's
 * `llm-*` rows, including providers nested under a `providers` map.
 *
 * Shaped to tolerate the several ways adapters spell these rows: a row may
 * carry `apiKeyEnv` directly (the DeepSeek adapter), or nest one entry per
 * provider under `providers` (the pi-ai adapter).
 * @param {{ id?: string, name?: string, config?: unknown }[]} rows
 * @returns {Map<string, { baseURL: string | null, apiKeyEnv: string | null }>}
 */
export function collectLlmRows(rows) {
  const found = new Map()
  if (!Array.isArray(rows)) return found
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const config = row.config
    if (config === null || typeof config !== 'object') continue
    const direct = {
      baseURL: text(config.baseURL),
      apiKeyEnv: text(config.apiKeyEnv),
    }
    const providers = config.providers
    if (providers !== null && typeof providers === 'object' && !Array.isArray(providers)) {
      for (const [providerId, providerConfig] of Object.entries(providers)) {
        if (providerConfig === null || typeof providerConfig !== 'object') continue
        found.set(providerId, {
          baseURL: text(providerConfig.baseURL) ?? direct.baseURL,
          apiKeyEnv: text(providerConfig.apiKeyEnv) ?? direct.apiKeyEnv,
        })
      }
    }
    // A row that configures one provider directly rather than through a
    // `providers` map: its provider id is derived from the package name
    // (`…/dsh-llm-deepseek-api-key` → `deepseek`), which is the id requests
    // actually name. The row id is registered too, so either spelling resolves.
    if (direct.baseURL === null && direct.apiKeyEnv === null) continue
    const derived = providerIdFromRowName(row.name)
    if (derived !== '') found.set(derived, direct)
    const rowId = text(row.id)
    if (rowId !== null && !found.has(rowId)) found.set(rowId, direct)
  }
  return found
}

/**
 * Strip a DSH row id down to the provider id an `llm-*` row usually names.
 * `@deepseek-ai/dsh-llm-pi-ai` → `pi-ai`; a plain `deepseek` passes through.
 * @param {string} name
 * @returns {string}
 */
export function providerIdFromRowName(name) {
  const value = text(name)
  if (value === null) return ''
  const withoutScope = value.replace(/^@[^/]+\//, '')
  const withoutPrefix = withoutScope.replace(/^dsh-llm-/, '')
  return withoutPrefix.replace(/-api-key$|-account$/, '')
}

/**
 * Build the route list to display and query.
 *
 * @param {object} input
 * @param {unknown[]} [input.providers]  Result of `ctx.llm.listProviders()`.
 * @param {Map<string, { baseURL: string | null, apiKeyEnv: string | null }>} [input.llmRows]
 * @param {{ id?: string, baseURL?: string, apiKeyEnv?: string, endpoint?: string }[]} [input.overrides]
 * @returns {RouteInfo[]}
 */
export function discoverRoutes(input = {}) {
  const providers = Array.isArray(input.providers) ? input.providers : []
  const llmRows = input.llmRows instanceof Map ? input.llmRows : new Map()
  const overrides = Array.isArray(input.overrides) ? input.overrides : []

  /** @type {Map<string, RouteInfo>} */
  const routes = new Map()

  for (const provider of providers) {
    if (provider === null || typeof provider !== 'object') continue
    const id = text(provider.id) ?? text(provider.providerId) ?? text(provider.name)
    if (id === null) continue
    // Adapters spell connection info differently; take the first that reads.
    const baseURL =
      text(provider.baseURL) ?? text(provider.baseUrl) ?? text(provider.endpoint) ?? null
    const apiKeyEnv = text(provider.apiKeyEnv) ?? null
    routes.set(id, buildRoute({ id, baseURL, apiKeyEnv, source: 'listProviders' }))
  }

  // Rows the runtime did not surface as providers still describe real gateways
  // — an adapter that is configured but not currently selected, for instance.
  for (const [id, row] of llmRows) {
    if (routes.has(id)) {
      const existing = routes.get(id)
      if (existing.baseURL === null && row.baseURL !== null) existing.baseURL = row.baseURL
      if (existing.apiKeyEnv === null && row.apiKeyEnv !== null) existing.apiKeyEnv = row.apiKeyEnv
      continue
    }
    routes.set(id, buildRoute({ id, baseURL: row.baseURL, apiKeyEnv: row.apiKeyEnv, source: 'profile-config' }))
  }

  for (const override of overrides) {
    if (override === null || typeof override !== 'object') continue
    const id = text(override.id)
    if (id === null) continue
    const existing = routes.get(id)
    const endpoint = text(override.endpoint)
    if (existing === undefined) {
      routes.set(id, buildRoute({
        id,
        baseURL: text(override.baseURL),
        apiKeyEnv: text(override.apiKeyEnv),
        endpoint,
        source: 'override',
      }))
      continue
    }
    existing.baseURL = text(override.baseURL) ?? existing.baseURL
    existing.apiKeyEnv = text(override.apiKeyEnv) ?? existing.apiKeyEnv
    existing.endpoint = endpoint ?? existing.endpoint
    existing.source = 'override'
  }

  // Local fix (2026-10-27): re-resolve the catalog match after row enrichment
  // and user overrides. buildRoute() ran before those fields were known, so a
  // provider surfaced by listProviders() without a baseURL (e.g. pi-ai routes
  // such as zai-coding-cn) kept `entry: undefined` forever and was reported as
  // an unknown relay even after its gateway became known.
  return [...routes.values()].map((route) => buildRoute({
    id: route.id,
    baseURL: route.baseURL,
    apiKeyEnv: route.apiKeyEnv,
    endpoint: route.endpoint,
    source: route.source,
  }))
}

/**
 * Assemble one route row, resolving its catalog match.
 * @param {{ id: string, baseURL: string | null, apiKeyEnv: string | null, endpoint?: string | null, source: string }} input
 * @returns {RouteInfo}
 */
function buildRoute(input) {
  const match = matchRoute({ id: input.id, baseURL: input.baseURL ?? undefined })
  const entry = match?.entry
  return {
    id: input.id,
    label: entry?.label ?? input.id,
    baseURL: input.baseURL ?? entry?.baseURL ?? null,
    apiKeyEnv: input.apiKeyEnv ?? entry?.env[0] ?? null,
    endpoint: input.endpoint ?? null,
    entry,
    source: input.source !== '' ? input.source : (match?.matchedBy ?? 'unknown'),
    catalogued: entry !== undefined,
  }
}

/**
 * Decide which route the header chip describes.
 *
 * Precedence: the user's explicit `primary`, then the first route DSH has that
 * this plugin can actually read, then the first catalogued route. Returns null
 * only when there are no routes at all.
 * @param {RouteInfo[]} routes
 * @param {string | null} [primary]
 * @returns {RouteInfo | null}
 */
export function pickPrimaryRoute(routes, primary) {
  if (!Array.isArray(routes) || routes.length === 0) return null
  const wanted = text(primary)
  if (wanted !== null) {
    const exact = routes.find((route) => route.id === wanted)
    if (exact !== undefined) return exact
  }
  return routes.find((route) => route.catalogued) ?? routes[0]
}

/**
 * The complete set of hostnames this plugin may contact, for documentation and
 * for asserting that no other domain is ever requested.
 *
 * This is `ALLOWED_HOSTS`, not just the catalog's hosts: a control-plane provider
 * (OpenDesign) is contacted on a host its route's baseURL never names, so the
 * catalog alone would under-report the set the plugin actually reaches.
 * @returns {string[]}
 */
export function allowedHosts() {
  return [...ALLOWED_HOSTS]
}

export { findById }

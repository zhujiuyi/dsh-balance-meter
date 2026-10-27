import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  allowedHosts,
  collectLlmRows,
  discoverRoutes,
  pickPrimaryRoute,
  providerIdFromRowName,
} from '../plugin/routes.mjs'

describe('providerIdFromRowName', () => {
  it('derives the provider id from an adapter package name', () => {
    assert.equal(providerIdFromRowName('@deepseek-ai/dsh-llm-deepseek-api-key'), 'deepseek')
    assert.equal(providerIdFromRowName('@deepseek-ai/dsh-llm-deepseek-account'), 'deepseek')
    assert.equal(providerIdFromRowName('@deepseek-ai/dsh-llm-pi-ai'), 'pi-ai')
  })

  it('passes through a name with no prefix', () => {
    assert.equal(providerIdFromRowName('deepseek'), 'deepseek')
  })

  it('returns an empty string for junk', () => {
    assert.equal(providerIdFromRowName(''), '')
    assert.equal(providerIdFromRowName(undefined), '')
  })
})

describe('collectLlmRows', () => {
  it('reads a nested providers map, which is how the pi-ai adapter configures routes', () => {
    const rows = [{
      id: 'llm-pi-ai',
      name: '@deepseek-ai/dsh-llm-pi-ai',
      config: { providers: { 'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY' } } },
    }]
    const found = collectLlmRows(rows)
    assert.deepEqual(found.get('opencode-go'), { baseURL: null, apiKeyEnv: 'OPENCODE_GO_API_KEY' })
  })

  it('reads a flat row and keys it by the derived provider id', () => {
    const rows = [{
      id: 'llm-deepseek',
      name: '@deepseek-ai/dsh-llm-deepseek-api-key',
      config: { baseURL: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY' },
    }]
    const found = collectLlmRows(rows)
    assert.deepEqual(found.get('deepseek'), {
      baseURL: 'https://api.deepseek.com',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
    })
  })

  it('lets a nested provider inherit a baseURL declared at the row level', () => {
    const rows = [{
      id: 'llm-pi-ai',
      name: '@deepseek-ai/dsh-llm-pi-ai',
      config: {
        baseURL: 'https://shared.example',
        providers: { a: { apiKeyEnv: 'A_KEY' } },
      },
    }]
    assert.equal(collectLlmRows(rows).get('a').baseURL, 'https://shared.example')
  })

  it('ignores rows without a config object', () => {
    assert.equal(collectLlmRows([{ id: 'x', name: 'y' }]).size, 0)
    assert.equal(collectLlmRows([{ id: 'x', name: 'y', config: null }]).size, 0)
  })

  it('ignores malformed rows instead of throwing', () => {
    assert.equal(collectLlmRows([null, 'nope', 42]).size, 0)
  })

  it('tolerates a non-array input', () => {
    assert.equal(collectLlmRows(undefined).size, 0)
    assert.equal(collectLlmRows({}).size, 0)
  })
})

describe('discoverRoutes', () => {
  it('builds a route from listProviders output', () => {
    const routes = discoverRoutes({ providers: [{ id: 'deepseek' }] })
    assert.equal(routes.length, 1)
    assert.equal(routes[0].id, 'deepseek')
    assert.equal(routes[0].label, 'DeepSeek')
    assert.equal(routes[0].baseURL, 'https://api.deepseek.com')
    assert.equal(routes[0].apiKeyEnv, 'DEEPSEEK_API_KEY')
    assert.equal(routes[0].catalogued, true)
    assert.equal(routes[0].source, 'listProviders')
  })

  it('prefers a baseURL the provider reported over the catalog default', () => {
    const routes = discoverRoutes({
      providers: [{ id: 'deepseek', baseURL: 'https://my-gateway.example/v1' }],
    })
    assert.equal(routes[0].baseURL, 'https://my-gateway.example/v1')
  })

  it('matches an uncatalogued route to nothing and still reports it', () => {
    const routes = discoverRoutes({
      providers: [{ id: 'my-relay', baseURL: 'https://relay.example.com/v1' }],
    })
    assert.equal(routes[0].catalogued, false)
    assert.equal(routes[0].entry, undefined)
    assert.equal(routes[0].label, 'my-relay')
    assert.equal(routes[0].apiKeyEnv, null)
  })

  it('fills a gap in listProviders output from the profile config', () => {
    const llmRows = new Map([['opencode-go', { baseURL: null, apiKeyEnv: 'OPENCODE_GO_API_KEY' }]])
    const routes = discoverRoutes({ providers: [{ id: 'opencode-go' }], llmRows })
    assert.equal(routes[0].apiKeyEnv, 'OPENCODE_GO_API_KEY')
    assert.equal(routes[0].source, 'listProviders')
  })

  it('re-matches the catalog once the profile config supplies a late baseURL', () => {
    // A pi-ai provider reaches listProviders() without a baseURL, so the first
    // buildRoute() has no host to match. The profile row that fills the baseURL
    // in afterwards must re-run the match: otherwise a known vendor (Z.ai here)
    // is reported as an uncatalogued relay for the rest of the process.
    const llmRows = new Map([['zai-coding-cn', {
      baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
      apiKeyEnv: 'ZAI_CODING_CN_API_KEY',
    }]])
    const routes = discoverRoutes({ providers: [{ id: 'zai-coding-cn' }], llmRows })
    assert.equal(routes.length, 1)
    assert.equal(routes[0].catalogued, true)
    assert.equal(routes[0].entry.id, 'zhipu')
    assert.equal(routes[0].label, '智谱 GLM / Z.AI')
    assert.equal(routes[0].baseURL, 'https://open.bigmodel.cn/api/coding/paas/v4')
    assert.equal(routes[0].apiKeyEnv, 'ZAI_CODING_CN_API_KEY')
  })

  it('includes a configured route that listProviders did not report', () => {
    const llmRows = new Map([['opencode-go', { baseURL: 'https://opencode.ai', apiKeyEnv: 'OC_KEY' }]])
    const routes = discoverRoutes({ providers: [], llmRows })
    assert.equal(routes.length, 1)
    assert.equal(routes[0].id, 'opencode-go')
    assert.equal(routes[0].source, 'profile-config')
    assert.equal(routes[0].catalogued, true)
  })

  it('lets an override win over both other sources', () => {
    const llmRows = new Map([['deepseek', { baseURL: 'https://from-config', apiKeyEnv: 'FROM_CONFIG' }]])
    const routes = discoverRoutes({
      providers: [{ id: 'deepseek', baseURL: 'https://from-provider' }],
      llmRows,
      overrides: [{ id: 'deepseek', baseURL: 'https://from-override', apiKeyEnv: 'FROM_OVERRIDE' }],
    })
    assert.equal(routes[0].baseURL, 'https://from-override')
    assert.equal(routes[0].apiKeyEnv, 'FROM_OVERRIDE')
    assert.equal(routes[0].source, 'override')
  })

  it('adds an override-only route the runtime does not know about', () => {
    const routes = discoverRoutes({
      providers: [],
      overrides: [{ id: 'siliconflow', baseURL: 'https://api.siliconflow.cn/v1', endpoint: '{origin}/x' }],
    })
    assert.equal(routes.length, 1)
    assert.equal(routes[0].id, 'siliconflow')
    assert.equal(routes[0].catalogued, true)
    assert.equal(routes[0].endpoint, '{origin}/x')
  })

  it('keeps a partial override from wiping fields it did not set', () => {
    const routes = discoverRoutes({
      providers: [{ id: 'deepseek', baseURL: 'https://kept.example' }],
      overrides: [{ id: 'deepseek', endpoint: '{origin}/x' }],
    })
    assert.equal(routes[0].baseURL, 'https://kept.example')
    assert.equal(routes[0].apiKeyEnv, 'DEEPSEEK_API_KEY')
    assert.equal(routes[0].endpoint, '{origin}/x')
  })

  it('ignores malformed providers and overrides', () => {
    const routes = discoverRoutes({ providers: [null, 'x', {}], overrides: [null, {}, 'y'] })
    assert.deepEqual(routes, [])
  })

  it('returns an empty list rather than throwing when given nothing', () => {
    assert.deepEqual(discoverRoutes(), [])
  })

  it('de-duplicates a provider reported once', () => {
    const routes = discoverRoutes({ providers: [{ id: 'deepseek' }, { id: 'deepseek' }] })
    assert.equal(routes.length, 1)
  })
})

describe('pickPrimaryRoute', () => {
  const deepseek = { id: 'deepseek', catalogued: true }
  const relay = { id: 'relay', catalogued: false }

  it('honours the configured primary', () => {
    assert.equal(pickPrimaryRoute([deepseek, relay], 'relay').id, 'relay')
  })

  it('falls through to the first catalogued route when primary is unset', () => {
    assert.equal(pickPrimaryRoute([relay, deepseek], null).id, 'deepseek')
  })

  it('falls through when primary names a route that is not present', () => {
    assert.equal(pickPrimaryRoute([deepseek], 'ghost').id, 'deepseek')
  })

  it('uses the first route when none are catalogued', () => {
    assert.equal(pickPrimaryRoute([relay], null).id, 'relay')
  })

  it('returns null for an empty list', () => {
    assert.equal(pickPrimaryRoute([], null), null)
    assert.equal(pickPrimaryRoute(undefined, null), null)
  })
})

describe('allowedHosts', () => {
  it('includes alias hosts and catalog base URLs', () => {
    const hosts = allowedHosts()
    assert.ok(hosts.includes('api.moonshot.ai'))
    assert.ok(hosts.includes('api.minimax.io'))
    assert.ok(hosts.includes('api.deepseek.com'))
  })

  it('includes the OpenDesign control plane, which no route baseURL names', () => {
    // The route's baseURL is the Link gateway; the billing read goes to a
    // different host. An allow-list built only from catalog base URLs would
    // under-report what this plugin actually contacts.
    const hosts = allowedHosts()
    assert.ok(hosts.includes('amr-api.open-design.ai'))
    assert.ok(hosts.includes('amr-link.open-design.ai'))
  })

  it('is sorted and de-duplicated', () => {
    const hosts = allowedHosts()
    assert.deepEqual(hosts, [...hosts].sort())
    assert.equal(new Set(hosts).size, hosts.length)
  })
})

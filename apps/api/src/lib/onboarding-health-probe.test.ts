import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { HarnessError } from '@patioer/harness'
import type { AppDb } from '@patioer/db'
import { runOnboardingHealthProbe } from './onboarding-health-probe.js'

const {
  mockListPlatforms,
  mockQueryCred,
  mockGetOrCreate,
  mockInvalidate,
  mockProbeExecution,
} = vi.hoisted(() => ({
  mockListPlatforms: vi.fn(),
  mockQueryCred: vi.fn(),
  mockGetOrCreate: vi.fn(),
  mockInvalidate: vi.fn(),
  mockProbeExecution: vi.fn(),
}))

vi.mock('./resolve-credential.js', () => ({
  listEnabledPlatformsFromDb: (...a: unknown[]) => mockListPlatforms(...a),
  queryCredentialForPlatform: (...a: unknown[]) => mockQueryCred(...a),
}))

vi.mock('./harness-from-credential.js', () => ({
  getOrCreateHarnessFromCredential: (...a: unknown[]) => mockGetOrCreate(...a),
}))

vi.mock('./harness-registry.js', () => ({
  registry: { invalidate: mockInvalidate },
}))

vi.mock('./agent-execute-probe.js', () => ({
  probeAgentExecution: (...a: unknown[]) => mockProbeExecution(...a),
}))

function makeAgentRows(
  types: string[],
): { id: string; type: string; name: string }[] {
  return types.map((type, i) => ({
    id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    type,
    name: `${type} Name`,
  }))
}

function makeTenantDb(rows: { id: string; type: string; name: string }[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    }),
  } as unknown as AppDb
}

const log = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => log),
} as never

let savedPaperclip: { url?: string; key?: string }

beforeEach(() => {
  vi.clearAllMocks()
  savedPaperclip = {
    url: process.env.PAPERCLIP_API_URL,
    key: process.env.PAPERCLIP_API_KEY,
  }
  delete process.env.PAPERCLIP_API_URL
  delete process.env.PAPERCLIP_API_KEY

  mockListPlatforms.mockResolvedValue(['shopify'])
  mockQueryCred.mockResolvedValue({
    accessToken: 'tok',
    shopDomain: 'shop',
    region: 'global',
    metadata: null,
  })
  const harness = { getProducts: vi.fn().mockResolvedValue([]) }
  mockGetOrCreate.mockReturnValue(harness)
  mockProbeExecution.mockResolvedValue({
    ok: true,
    agentId: '10000000-0000-4000-8000-000000000000',
    agentType: 'product-scout',
    platform: 'shopify',
    probe: 'agent_execute',
  })
})

afterEach(() => {
  if (savedPaperclip.url === undefined) delete process.env.PAPERCLIP_API_URL
  else process.env.PAPERCLIP_API_URL = savedPaperclip.url
  if (savedPaperclip.key === undefined) delete process.env.PAPERCLIP_API_KEY
  else process.env.PAPERCLIP_API_KEY = savedPaperclip.key
})

describe('runOnboardingHealthProbe', () => {
  it('returns ok when platform probe succeeds, five agents, and execute probe ok', async () => {
    const rows = makeAgentRows([
      'product-scout',
      'price-sentinel',
      'support-relay',
      'ads-optimizer',
      'inventory-guard',
    ])
    const body = await runOnboardingHealthProbe({
      tenantId: 't1',
      withDb: async (cb) => cb(makeTenantDb(rows)),
      log,
    })
    expect(body.ok).toBe(true)
    expect(body.platforms).toEqual([{ platform: 'shopify', ok: true, probe: 'getProducts:1' }])
    expect(body.agents.count).toBe(5)
    expect(body.summary.heartbeatOk).toBe(true)
    expect(body.agentHeartbeat.probe).toBe('agent_execute')
    expect(body.agentHeartbeat.ok).toBe(true)
  })

  it('returns ok false when fewer than five agents', async () => {
    const body = await runOnboardingHealthProbe({
      tenantId: 't1',
      withDb: async (cb) => cb(makeTenantDb(makeAgentRows(['product-scout', 'price-sentinel']))),
      log,
    })
    expect(body.ok).toBe(false)
    expect(body.agents.meetsMinimum).toBe(false)
  })

  it('returns ok false when no connected platforms', async () => {
    mockListPlatforms.mockResolvedValue([])
    const body = await runOnboardingHealthProbe({
      tenantId: 't1',
      withDb: async (cb) => cb(makeTenantDb(makeAgentRows(['a', 'b', 'c', 'd', 'e']))),
      log,
    })
    expect(body.ok).toBe(false)
    expect(body.platforms).toEqual([])
    expect(body.platforms.filter((p: { ok: boolean }) => !p.ok)).toHaveLength(0)
  })

  it('invalidates registry on HarnessError 401', async () => {
    const harness = {
      getProducts: vi.fn().mockRejectedValue(new HarnessError('shopify', '401', 'unauthorized')),
    }
    mockGetOrCreate.mockReturnValue(harness)

    const body = await runOnboardingHealthProbe({
      tenantId: 't1',
      withDb: async (cb) =>
        cb(
          makeTenantDb(
            makeAgentRows([
              'product-scout',
              'price-sentinel',
              'support-relay',
              'ads-optimizer',
              'inventory-guard',
            ]),
          ),
        ),
      log,
    })
    expect(body.platforms[0]?.ok).toBe(false)
    expect(body.platforms.filter((p: { ok: boolean }) => !p.ok)).toHaveLength(1)
    expect(mockInvalidate).toHaveBeenCalledWith('t1:shopify')
  })

  it('single platform failure keeps detail in platforms[] and fails overall ok', async () => {
    const harness = {
      getProducts: vi.fn().mockRejectedValue(new Error('rate_limited')),
    }
    mockGetOrCreate.mockReturnValue(harness)

    const body = await runOnboardingHealthProbe({
      tenantId: 't1',
      withDb: async (cb) =>
        cb(
          makeTenantDb(
            makeAgentRows([
              'product-scout',
              'price-sentinel',
              'support-relay',
              'ads-optimizer',
              'inventory-guard',
            ]),
          ),
        ),
      log,
    })
    expect(body.platforms[0]?.ok).toBe(false)
    expect(body.platforms[0]?.error).toContain('rate_limited')
    expect(body.platforms.filter((p: { ok: boolean }) => !p.ok)).toHaveLength(1)
    expect(body.ok).toBe(false)
  })

  it('execute probe failure makes overall ok false', async () => {
    mockProbeExecution.mockResolvedValue({
      ok: false,
      agentId: '',
      agentType: '',
      platform: '',
      error: 'no_credentials',
      probe: 'agent_execute',
    })

    const body = await runOnboardingHealthProbe({
      tenantId: 't1',
      withDb: async (cb) =>
        cb(
          makeTenantDb(
            makeAgentRows([
              'product-scout',
              'price-sentinel',
              'support-relay',
              'ads-optimizer',
              'inventory-guard',
            ]),
          ),
        ),
      log,
    })
    expect(body.summary.heartbeatOk).toBe(false)
    expect(body.agentHeartbeat.ok).toBe(false)
    expect(body.agentHeartbeat.error).toBe('no_credentials')
    expect(body.ok).toBe(false)
  })

  it('reports paperclip configured status from env', async () => {
    process.env.PAPERCLIP_API_URL = 'http://paperclip.test'
    process.env.PAPERCLIP_API_KEY = 'k'

    const body = await runOnboardingHealthProbe({
      tenantId: 't1',
      withDb: async (cb) =>
        cb(
          makeTenantDb(
            makeAgentRows([
              'product-scout',
              'price-sentinel',
              'support-relay',
              'ads-optimizer',
              'inventory-guard',
            ]),
          ),
        ),
      log,
    })
    expect(body.paperclip.configured).toBe(true)
    expect(body.ok).toBe(true)
  })
})

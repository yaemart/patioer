import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockSeed = vi.hoisted(() => vi.fn())
const mockHealth = vi.hoisted(() => vi.fn())

vi.mock('../lib/seed-default-agents.js', () => ({
  seedDefaultAgents: (...args: unknown[]) => mockSeed(...args),
  defaultAgentSpecs: () => [
    { name: 'P', type: 'product-scout', goalContext: '{}' },
    { name: 'X', type: 'price-sentinel', goalContext: '{}' },
    { name: 'S', type: 'support-relay', goalContext: '{}' },
    { name: 'A', type: 'ads-optimizer', goalContext: '{}' },
    { name: 'I', type: 'inventory-guard', goalContext: '{}' },
  ],
}))

vi.mock('../lib/onboarding-health-probe.js', () => ({
  runOnboardingHealthProbe: (...args: unknown[]) => mockHealth(...args),
}))

import onboardingRoute from './onboarding.js'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'

beforeEach(() => {
  vi.clearAllMocks()
  mockSeed.mockResolvedValue({
    created: ['product-scout'],
    skipped: [],
    registered: [],
  })
  mockHealth.mockResolvedValue({
    ok: true,
    tenantId: TENANT_ID,
    platforms: [],
    agentHeartbeat: { agentType: '_', agentId: '', ok: true, probe: 'agent_execute' },
    agents: { count: 5, types: [], expectedMin: 5, meetsMinimum: true },
    paperclip: { configured: false },
    summary: { heartbeatOk: true },
  })
})

afterEach(() => {
  delete process.env.ONBOARDING_REGISTER_API_KEY
})

function buildApp(options?: { withTenant?: boolean }) {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    if (options?.withTenant === false) {
      request.withDb = null
      request.tenantId = undefined
      return
    }
    request.tenantId = TENANT_ID
    request.withDb = async (cb) => cb({} as never)
  })
  app.register(onboardingRoute)
  return app
}

describe('POST /api/v1/onboarding/initialize-agents', () => {
  it('returns 401 without tenant context', async () => {
    const app = buildApp({ withTenant: false })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/onboarding/initialize-agents',
    })
    expect(res.statusCode).toBe(401)
    expect(mockSeed).not.toHaveBeenCalled()
    await app.close()
  })

  it('returns seed result and expectedTypes', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/onboarding/initialize-agents',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { created: string[]; expectedTypes: string[] }
    expect(body.created).toEqual(['product-scout'])
    expect(body.expectedTypes).toHaveLength(5)
    expect(mockSeed).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
    )
    await app.close()
  })
})

describe('GET /api/v1/onboarding/health', () => {
  it('returns 401 without tenant context', async () => {
    const app = buildApp({ withTenant: false })
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/onboarding/health',
    })
    expect(res.statusCode).toBe(401)
    expect(mockHealth).not.toHaveBeenCalled()
    await app.close()
  })

  it('returns health payload from probe', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/onboarding/health',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
    expect(mockHealth).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
    )
    await app.close()
  })
})

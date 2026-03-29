/**
 * Route registration smoke tests.
 *
 * Each test only asserts statusCode !== 404, which proves the route is
 * mounted.  Business-logic assertions live in the per-route test files.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../app.js'

// --- Silence all external dependencies so buildServer() always succeeds ---

vi.mock('@patioer/db', () => ({
  withTenantDb: vi.fn(),
  db: { select: vi.fn(), insert: vi.fn() },
  schema: {
    platformCredentials: { tenantId: 'tenantId', platform: 'platform', region: 'region' },
    webhookEvents: 'webhook_events',
    tenants: {},
    agents: {},
    approvals: {},
    adsCampaigns: {},
    inventoryLevels: {},
  },
}))

vi.mock('../lib/harness-registry.js', () => ({
  registry: { get: vi.fn(), getOrCreate: vi.fn(), invalidate: vi.fn() },
}))

vi.mock('../lib/harness-factory.js', () => ({
  createHarness: vi.fn(),
}))

vi.mock('../lib/resolve-credential.js', () => ({
  resolveFirstCredential: vi.fn(async () => ({
    cred: { accessToken: 'enc', shopDomain: 'shop.test', region: 'global', metadata: null },
    platform: 'shopify',
  })),
  listEnabledPlatformsFromDb: vi.fn(async () => []),
  queryCredentialForPlatform: vi.fn(async () => null),
}))

vi.mock('../lib/seed-default-agents.js', () => ({
  seedDefaultAgents: vi.fn(async () => ({
    created: [],
    skipped: [],
    registered: [],
  })),
  defaultAgentSpecs: vi.fn(() => []),
}))

vi.mock('../lib/onboarding-health-probe.js', () => ({
  runOnboardingHealthProbe: vi.fn(async () => ({
    ok: false,
    tenantId: '00000000-0000-0000-0000-000000000001',
    platforms: [],
    agentHeartbeat: { agentType: '_', agentId: '', ok: false, probe: 'agent_execute', error: 'no_agent_rows' },
    agents: { count: 0, types: [], expectedMin: 5, meetsMinimum: false },
    paperclip: { configured: false },
    summary: { heartbeatOk: false },
  })),
}))

vi.mock('../lib/resolve-harness.js', () => ({
  resolveHarness: vi.fn(async () => ({
    ok: true,
    harness: {
      getProductsPage: vi.fn(async () => ({ items: [], nextCursor: null })),
      getOrdersPage: vi.fn(async () => ({ items: [], nextCursor: null })),
    },
    platform: 'shopify',
    registryKey: 'smoke:shopify',
  })),
  handleHarnessError: vi.fn(),
}))

vi.mock('../lib/queue-factory.js', () => ({
  enqueueJob: vi.fn(async () => ({ id: 'job-1' })),
  getQueue: vi.fn(),
  createWorker: vi.fn(),
  closeAllQueues: vi.fn(async () => undefined),
}))

vi.mock('../lib/crypto.js', () => ({
  encryptToken: vi.fn(() => 'enc'),
  decryptToken: vi.fn(() => 'dec'),
}))

vi.mock('../lib/paperclip-bridge.js', () => ({
  PaperclipBridge: vi.fn().mockImplementation(() => ({
    registerAgent: vi.fn(),
    listAgents: vi.fn(),
    createIssue: vi.fn(),
  })),
}))

vi.mock('../lib/paperclip-auth.js', () => ({
  createPaperclipAuth: vi.fn(() => ({ apiKey: 'test-key' })),
}))

// ---

let app: FastifyInstance

beforeAll(async () => {
  app = buildServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

/**
 * Assert that a route is registered (any status except 404 is acceptable).
 * A 404 means the route was never mounted; 400/401/503 etc. mean it exists
 * but rejected the request for a business reason.
 */
async function assertRegistered(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  opts: { headers?: Record<string, string>; payload?: string; contentType?: string } = {},
): Promise<void> {
  const res = await app.inject({
    method,
    url,
    headers: {
      ...(opts.contentType ? { 'content-type': opts.contentType } : {}),
      ...(opts.headers ?? {}),
    },
    payload: opts.payload,
  })
  expect(res.statusCode, `${method} ${url} must be registered (not 404)`).not.toBe(404)
}

// ─── System ──────────────────────────────────────────────────────────────────

describe('Smoke — System routes', () => {
  it('GET /api/v1/health returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' })
    expect(res.statusCode).toBe(200)
  })

  it('GET /api/v1/docs redirects or returns 200 (Swagger UI)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/docs' })
    expect([200, 302]).toContain(res.statusCode)
  })
})

// ─── Shopify ─────────────────────────────────────────────────────────────────

describe('Smoke — Shopify routes', () => {
  it('GET /api/v1/shopify/auth is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/shopify/auth')
  })

  it('GET /api/v1/shopify/callback is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/shopify/callback')
  })

  it('POST /api/v1/webhooks/shopify is registered (non-404)', async () => {
    await assertRegistered('POST', '/api/v1/webhooks/shopify', {
      contentType: 'application/json',
      payload: '{}',
    })
  })
})

// ─── Amazon ──────────────────────────────────────────────────────────────────

describe('Smoke — Amazon routes', () => {
  it('GET /api/v1/amazon/auth is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/amazon/auth')
  })

  it('GET /api/v1/amazon/auth/callback is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/amazon/auth/callback')
  })

  it('POST /api/v1/webhooks/amazon is registered (non-404)', async () => {
    await assertRegistered('POST', '/api/v1/webhooks/amazon', {
      contentType: 'text/plain',
      payload: 'bad-json',
    })
  })
})

// ─── Business routes ─────────────────────────────────────────────────────────

describe('Smoke — Business routes', () => {
  const tenantHeader = { 'x-tenant-id': '00000000-0000-0000-0000-000000000001' }

  it('POST /api/v1/onboarding/register is registered (non-404)', async () => {
    await assertRegistered('POST', '/api/v1/onboarding/register', {
      contentType: 'application/json',
      payload: '{}',
    })
  })

  it('POST /api/v1/onboarding/initialize-agents is registered (non-404)', async () => {
    await assertRegistered('POST', '/api/v1/onboarding/initialize-agents', {
      headers: tenantHeader,
      contentType: 'application/json',
      payload: '{}',
    })
  })

  it('GET /api/v1/onboarding/health is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/onboarding/health', { headers: tenantHeader })
  })

  it('POST /api/v1/products/sync is registered (non-404)', async () => {
    await assertRegistered('POST', '/api/v1/products/sync', {
      headers: tenantHeader,
      contentType: 'application/json',
      payload: '{}',
    })
  })

  it('GET /api/v1/orders is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/orders', { headers: tenantHeader })
  })

  it('GET /api/v1/agents is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/agents', { headers: tenantHeader })
  })

  it('GET /api/v1/approvals is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/approvals', { headers: tenantHeader })
  })

  it('GET /api/v1/platform-credentials is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/platform-credentials', { headers: tenantHeader })
  })

  it('GET /api/v1/ads/campaigns is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/ads/campaigns', { headers: tenantHeader })
  })

  it('GET /api/v1/ads/performance is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/ads/performance', { headers: tenantHeader })
  })

  it('GET /api/v1/inventory is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/inventory', { headers: tenantHeader })
  })

  it('GET /api/v1/inventory/alerts is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/inventory/alerts', { headers: tenantHeader })
  })
})

// ─── Walmart ──────────────────────────────────────────────────────────────────

describe('Smoke — Walmart routes', () => {
  it('POST /api/v1/walmart/credentials is registered (non-404)', async () => {
    await assertRegistered('POST', '/api/v1/walmart/credentials', {
      contentType: 'application/json',
      payload: '{}',
    })
  })

  it('GET /api/v1/walmart/auth is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/walmart/auth')
  })

  it('GET /api/v1/walmart/auth/callback is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/walmart/auth/callback')
  })

  it('POST /api/v1/webhooks/walmart is registered (non-404)', async () => {
    await assertRegistered('POST', '/api/v1/webhooks/walmart', {
      contentType: 'application/json',
      payload: '{}',
    })
  })
})

// ─── B2B Wayfair ─────────────────────────────────────────────────────────

describe('Smoke — B2B Wayfair routes', () => {
  it('POST /api/v1/b2b/wayfair/credentials is registered (non-404)', async () => {
    await assertRegistered('POST', '/api/v1/b2b/wayfair/credentials', {
      contentType: 'application/json',
      payload: '{}',
    })
  })

  it('GET /api/v1/b2b/wayfair/status is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/b2b/wayfair/status', {
      headers: { 'x-tenant-id': '00000000-0000-0000-0000-000000000001' },
    })
  })
})

// ─── Console B2B ─────────────────────────────────────────────────────────

describe('Smoke — Console B2B route', () => {
  it('GET /api/v1/console/b2b is registered (non-404)', async () => {
    await assertRegistered('GET', '/api/v1/console/b2b', {
      headers: { 'x-tenant-id': '00000000-0000-0000-0000-000000000001' },
    })
  })
})

// ─── Unknown route ───────────────────────────────────────────────────────────

describe('Smoke — Unknown route', () => {
  it('GET /api/v1/nonexistent returns 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nonexistent' })
    expect(res.statusCode).toBe(404)
  })
})

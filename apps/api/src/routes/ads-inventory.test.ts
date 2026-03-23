import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import adsInventoryRoute from './ads-inventory.js'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'

function createApp(
  responses: unknown[],
  options?: { withTenant?: boolean },
): ReturnType<typeof Fastify> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    if (options?.withTenant === false) {
      request.withDb = null
      request.tenantId = undefined
      return
    }
    request.tenantId = TENANT_ID
    request.withDb = async () => {
      if (responses.length === 0) throw new Error('withDb queue empty')
      return responses.shift() as never
    }
  })
  app.register(adsInventoryRoute)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ads-inventory routes', () => {
  it('GET /ads/campaigns returns 401 without tenant', async () => {
    const app = createApp([], { withTenant: false })
    const res = await app.inject({ method: 'GET', url: '/api/v1/ads/campaigns' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'x-tenant-id required' })
    await app.close()
  })

  it('GET /ads/campaigns returns 400 for invalid limit', async () => {
    const app = createApp([])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ads/campaigns?limit=0',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'invalid query' })
    await app.close()
  })

  it('GET /ads/campaigns returns { campaigns: [] }', async () => {
    const app = createApp([[]])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ads/campaigns',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ campaigns: [] })
    await app.close()
  })

  it('GET /ads/performance returns { items: [] }', async () => {
    const app = createApp([[]])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ads/performance',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [] })
    await app.close()
  })

  it('GET /inventory returns { items: [] }', async () => {
    const app = createApp([[]])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/inventory',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [] })
    await app.close()
  })

  it('GET /inventory/alerts returns { items: [] }', async () => {
    const app = createApp([[]])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/inventory/alerts',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ items: [] })
    await app.close()
  })

  it('GET /ads/campaigns echoes row shape from withDb', async () => {
    const rows = [
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        tenantId: TENANT_ID,
        platform: 'shopify',
        platformCampaignId: 'c1',
        name: 'Test',
        status: 'active',
        dailyBudget: '10.00',
        totalSpend: '1.00',
        roas: '2.00',
        syncedAt: null,
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    ]
    const app = createApp([rows])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ads/campaigns',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { campaigns: typeof rows }
    expect(body.campaigns).toHaveLength(1)
    expect(body.campaigns[0]?.platformCampaignId).toBe('c1')
    await app.close()
  })
})

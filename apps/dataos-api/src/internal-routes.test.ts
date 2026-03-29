import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerInternalRoutes } from './internal-routes.js'
import type { DataOsServices } from '@patioer/dataos'
import { _runInsightAgentTick } from './workers/insight-agent.js'

vi.mock('./workers/insight-agent.js', () => ({
  _runInsightAgentTick: vi.fn().mockResolvedValue({ processed: 3, written: 2, failed: 1 }),
}))

const KEY = 'test-internal-key'
const TENANT = '550e8400-e29b-41d4-a716-446655440001'

function mockServices(): DataOsServices {
  return {
    eventLake: {
      insertEvent: vi.fn().mockResolvedValue(undefined),
      insertPriceEvent: vi.fn().mockResolvedValue(undefined),
      queryEvents: vi.fn().mockResolvedValue([{ event_id: 'e1' }]),
      queryPriceEvents: vi.fn().mockResolvedValue([{ event_id: 'pe1' }]),
      raw: {} as never,
      close: vi.fn(),
    },
    featureStore: {
      get: vi.fn().mockResolvedValue({ product_id: 'P001', price_current: '29.99' }),
      upsert: vi.fn().mockResolvedValue({ product_id: 'P001' }),
      list: vi.fn().mockResolvedValue([{ product_id: 'P001' }]),
      delete: vi.fn().mockResolvedValue(true),
      warmupCache: vi.fn(),
      close: vi.fn(),
    },
    decisionMemory: {
      recall: vi.fn().mockResolvedValue([{ id: 'm1' }]),
      record: vi.fn().mockResolvedValue('mem-new'),
      writeOutcome: vi.fn().mockResolvedValue(undefined),
      listRecent: vi.fn().mockResolvedValue([{ id: 'd1' }]),
      delete: vi.fn().mockResolvedValue(true),
      close: vi.fn(),
    },
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as unknown as DataOsServices
}

function headers(extra: Record<string, string> = {}) {
  return { 'x-dataos-internal-key': KEY, 'x-tenant-id': TENANT, ...extra }
}

let app: FastifyInstance
let svc: ReturnType<typeof mockServices>

beforeAll(async () => {
  app = Fastify()
  svc = mockServices()
  registerInternalRoutes(app, svc, KEY)
  await app.ready()
})

beforeEach(() => {
  vi.clearAllMocks()
  svc.eventLake.insertEvent = vi.fn().mockResolvedValue(undefined)
  svc.eventLake.insertPriceEvent = vi.fn().mockResolvedValue(undefined)
  svc.eventLake.queryEvents = vi.fn().mockResolvedValue([{ event_id: 'e1' }])
  svc.eventLake.queryPriceEvents = vi.fn().mockResolvedValue([{ event_id: 'pe1' }])
  svc.featureStore.get = vi.fn().mockResolvedValue({ product_id: 'P001', price_current: '29.99' })
  svc.featureStore.upsert = vi.fn().mockResolvedValue({ product_id: 'P001' })
  svc.featureStore.list = vi.fn().mockResolvedValue([{ product_id: 'P001' }])
  svc.featureStore.delete = vi.fn().mockResolvedValue(true)
  svc.decisionMemory.recall = vi.fn().mockResolvedValue([{ id: 'm1' }])
  svc.decisionMemory.record = vi.fn().mockResolvedValue('mem-new')
  svc.decisionMemory.writeOutcome = vi.fn().mockResolvedValue(undefined)
  svc.decisionMemory.listRecent = vi.fn().mockResolvedValue([{ id: 'd1' }])
})

afterAll(async () => {
  await app.close()
})

describe('auth', () => {
  it('rejects missing internal key with 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/lake/events',
      headers: { 'x-tenant-id': TENANT, 'content-type': 'application/json' },
      payload: { tenantId: TENANT, agentId: 'ps', eventType: 'test', payload: {} },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects missing X-Tenant-Id with 400', async () => {
    const res = await app.inject({
      method: 'GET', url: '/internal/v1/features/shopify/P001',
      headers: { 'x-dataos-internal-key': KEY },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /internal/v1/lake/events', () => {
  it('inserts event and returns ok', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/lake/events',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { tenantId: TENANT, agentId: 'ps', eventType: 'test', payload: {} },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(svc.eventLake.insertEvent).toHaveBeenCalled()
  })

  it('rejects invalid body with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/lake/events',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { agentId: 'ps' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects tenantId mismatch with 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/lake/events',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { tenantId: '660e8400-e29b-41d4-a716-446655440099', agentId: 'ps', eventType: 'test', payload: {} },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /internal/v1/lake/price-events', () => {
  it('inserts price event and returns ok', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/lake/price-events',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { tenantId: TENANT, platform: 'amazon', productId: 'P001', priceBefore: 10, priceAfter: 12, changePct: 20, approved: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('rejects tenantId mismatch with 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/lake/price-events',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { tenantId: '660e8400-e29b-41d4-a716-446655440099', platform: 'amazon', productId: 'P001', priceBefore: 10, priceAfter: 12, changePct: 20, approved: true },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('GET /internal/v1/lake/events', () => {
  it('returns events', async () => {
    const res = await app.inject({
      method: 'GET', url: '/internal/v1/lake/events?agentId=ps&limit=10',
      headers: headers(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ events: [{ event_id: 'e1' }] })
  })
})

describe('GET /internal/v1/lake/price-events', () => {
  it('returns price events', async () => {
    const res = await app.inject({
      method: 'GET', url: '/internal/v1/lake/price-events?productId=P001',
      headers: headers(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ events: [{ event_id: 'pe1' }] })
  })

  it('rejects missing X-Tenant-Id with 400', async () => {
    const res = await app.inject({
      method: 'GET', url: '/internal/v1/lake/price-events',
      headers: { 'x-dataos-internal-key': KEY },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /internal/v1/features', () => {
  it('lists features', async () => {
    const res = await app.inject({
      method: 'GET', url: '/internal/v1/features?platform=shopify&limit=5',
      headers: headers(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ features: [{ product_id: 'P001' }] })
  })
})

describe('GET /internal/v1/features/:platform/:productId', () => {
  it('returns a single feature row', async () => {
    const res = await app.inject({
      method: 'GET', url: '/internal/v1/features/shopify/P001',
      headers: headers(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveProperty('product_id', 'P001')
  })
})

describe('DELETE /internal/v1/features/:platform/:productId', () => {
  it('deletes and returns ok', async () => {
    const res = await app.inject({
      method: 'DELETE', url: '/internal/v1/features/shopify/P001',
      headers: headers(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, deleted: true })
  })
})

describe('GET /internal/v1/memory/decisions', () => {
  it('lists decisions', async () => {
    const res = await app.inject({
      method: 'GET', url: '/internal/v1/memory/decisions?agentId=ps&limit=5',
      headers: headers(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ decisions: [{ id: 'd1' }] })
  })
})

describe('POST /internal/v1/features/upsert', () => {
  it('upserts feature and returns ok', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/features/upsert',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { tenantId: TENANT, platform: 'shopify', productId: 'P001', priceCurrent: 29.99 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('rejects tenantId mismatch', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/features/upsert',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { tenantId: '660e8400-e29b-41d4-a716-446655440099', platform: 'shopify', productId: 'P001' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /internal/v1/memory/recall', () => {
  it('returns memories', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/memory/recall',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { agentId: 'ps', context: { price: 10 } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ memories: [{ id: 'm1' }] })
  })
})

describe('POST /internal/v1/memory/record', () => {
  it('records memory and returns id', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/memory/record',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { agentId: 'ps', context: { price: 10 }, action: { newPrice: 12 } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: 'mem-new' })
  })
})

describe('POST /internal/v1/memory/outcome', () => {
  it('writes outcome and returns ok', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/memory/outcome',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { tenantId: TENANT, decisionId: '550e8400-e29b-41d4-a716-446655440002', outcome: { revenue: 100 } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('rejects invalid body', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/memory/outcome',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { outcome: 'hi' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects tenantId mismatch with 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/memory/outcome',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { tenantId: '660e8400-e29b-41d4-a716-446655440099', decisionId: '550e8400-e29b-41d4-a716-446655440002', outcome: {} },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('DELETE /internal/v1/memory/decisions/:decisionId', () => {
  it('deletes and returns ok + deleted=true', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/internal/v1/memory/decisions/550e8400-e29b-41d4-a716-446655440002',
      headers: headers(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, deleted: true })
  })

  it('returns ok + deleted=false when record not found', async () => {
    svc.decisionMemory.delete = vi.fn().mockResolvedValue(false)
    const res = await app.inject({
      method: 'DELETE',
      url: '/internal/v1/memory/decisions/550e8400-e29b-41d4-a716-446655440002',
      headers: headers(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, deleted: false })
  })

  it('rejects invalid UUID with 400', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/internal/v1/memory/decisions/not-a-uuid',
      headers: headers(),
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects missing auth key with 401', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/internal/v1/memory/decisions/550e8400-e29b-41d4-a716-446655440002',
      headers: { 'x-tenant-id': TENANT },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /internal/v1/capabilities', () => {
  it('returns capabilities with auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/v1/capabilities',
      headers: { 'x-dataos-internal-key': KEY },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload)
    expect(body.version).toBe('1.1.0')
    expect(body.entities.codebase).toBeDefined()
    expect(body.entities.events).toBeDefined()
    expect(body.entities.features).toBeDefined()
    expect(body.entities.decisions).toBeDefined()
    expect(body.entities.priceEvents).toBeDefined()
  })

  it('rejects missing auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/v1/capabilities',
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('Memory routes — extended coverage (CARD-D32-02)', () => {
  describe('POST /internal/v1/memory/recall', () => {
    it('returns 401 without X-DataOS-Internal-Key', async () => {
      const res = await app.inject({
        method: 'POST', url: '/internal/v1/memory/recall',
        headers: { 'x-tenant-id': TENANT, 'content-type': 'application/json' },
        payload: { agentId: 'ps', context: {} },
      })
      expect(res.statusCode).toBe(401)
    })

    it('returns 400 without X-Tenant-Id', async () => {
      const res = await app.inject({
        method: 'POST', url: '/internal/v1/memory/recall',
        headers: { 'x-dataos-internal-key': KEY, 'content-type': 'application/json' },
        payload: { agentId: 'ps', context: {} },
      })
      expect(res.statusCode).toBe(400)
    })

    it('returns 400 with invalid body (missing agentId)', async () => {
      const res = await app.inject({
        method: 'POST', url: '/internal/v1/memory/recall',
        headers: { ...headers(), 'content-type': 'application/json' },
        payload: { context: { price: 10 } },
      })
      expect(res.statusCode).toBe(400)
    })

    it('passes limit and minSimilarity to decisionMemory.recall', async () => {
      await app.inject({
        method: 'POST', url: '/internal/v1/memory/recall',
        headers: { ...headers(), 'content-type': 'application/json' },
        payload: { agentId: 'ps', context: { p: 1 }, limit: 5, minSimilarity: 0.9 },
      })
      expect(svc.decisionMemory.recall).toHaveBeenCalledWith(
        TENANT, 'ps', { p: 1 }, { limit: 5, minSimilarity: 0.9 },
      )
    })
  })

  describe('POST /internal/v1/memory/record', () => {
    it('returns 401 without auth header', async () => {
      const res = await app.inject({
        method: 'POST', url: '/internal/v1/memory/record',
        headers: { 'x-tenant-id': TENANT, 'content-type': 'application/json' },
        payload: { agentId: 'ps', context: {}, action: {} },
      })
      expect(res.statusCode).toBe(401)
    })

    it('passes tenantId from X-Tenant-Id header (not body)', async () => {
      await app.inject({
        method: 'POST', url: '/internal/v1/memory/record',
        headers: { ...headers(), 'content-type': 'application/json' },
        payload: { agentId: 'ps', context: { x: 1 }, action: { y: 2 } },
      })
      expect(svc.decisionMemory.record).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT, agentId: 'ps' }),
      )
    })
  })

  describe('POST /internal/v1/memory/outcome', () => {
    it('returns 403 when body tenantId differs from X-Tenant-Id', async () => {
      const res = await app.inject({
        method: 'POST', url: '/internal/v1/memory/outcome',
        headers: { ...headers(), 'content-type': 'application/json' },
        payload: {
          tenantId: '660e8400-e29b-41d4-a716-446655440099',
          decisionId: '550e8400-e29b-41d4-a716-446655440002',
          outcome: {},
        },
      })
      expect(res.statusCode).toBe(403)
    })

    it('calls writeOutcome with correct params on success', async () => {
      const decisionId = '550e8400-e29b-41d4-a716-446655440002'
      await app.inject({
        method: 'POST', url: '/internal/v1/memory/outcome',
        headers: { ...headers(), 'content-type': 'application/json' },
        payload: { tenantId: TENANT, decisionId, outcome: { revenue: 500 } },
      })
      expect(svc.decisionMemory.writeOutcome).toHaveBeenCalledWith(
        decisionId, TENANT, { revenue: 500 },
      )
    })
  })

  describe('GET /internal/v1/memory/decisions', () => {
    it('returns decisions list with agentId filter', async () => {
      await app.inject({
        method: 'GET', url: '/internal/v1/memory/decisions?agentId=price-sentinel&limit=10',
        headers: headers(),
      })
      expect(svc.decisionMemory.listRecent).toHaveBeenCalledWith(
        TENANT, 'price-sentinel', { limit: 10 },
      )
    })

    it('returns empty list when no decisions', async () => {
      svc.decisionMemory.listRecent = vi.fn().mockResolvedValue([])
      const res = await app.inject({
        method: 'GET', url: '/internal/v1/memory/decisions?agentId=ps',
        headers: headers(),
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ decisions: [] })
    })
  })

  describe('DELETE /internal/v1/memory/decisions/:decisionId', () => {
    it('returns { deleted: false } for cross-tenant attempt', async () => {
      svc.decisionMemory.delete = vi.fn().mockResolvedValue(false)
      const res = await app.inject({
        method: 'DELETE',
        url: '/internal/v1/memory/decisions/550e8400-e29b-41d4-a716-446655440002',
        headers: headers(),
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().deleted).toBe(false)
    })
  })
})

describe('POST /internal/v1/insight/trigger', () => {
  it('returns 401 without auth header', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/insight/trigger',
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when X-Tenant-Id is missing (tenant isolation enforced)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/insight/trigger',
      headers: { 'x-dataos-internal-key': KEY },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns tick result on success with valid tenantId', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/insight/trigger',
      headers: { 'x-dataos-internal-key': KEY, 'x-tenant-id': TENANT },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, processed: 3, written: 2, failed: 1 })
    expect(_runInsightAgentTick).toHaveBeenCalledWith(
      expect.anything(),
      { outcomeLookbackDays: 7, maxDecisionsPerTick: 100, tenantId: TENANT },
    )
  })

  it('returns 400 for invalid X-Tenant-Id header', async () => {
    const res = await app.inject({
      method: 'POST', url: '/internal/v1/insight/trigger',
      headers: { 'x-dataos-internal-key': KEY, 'x-tenant-id': 'not-a-uuid' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('Codebase Intel — Agent-Native Parity (Gap-01 fix)', () => {
  it('GET /internal/v1/codebase/query returns matches for a known query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/v1/codebase/query?q=Price+Sentinel',
      headers: { 'x-dataos-internal-key': KEY },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.query).toBe('Price Sentinel')
    expect(Array.isArray(body.matches)).toBe(true)
    expect(typeof body.indexedAt).toBe('string')
    expect(typeof body.totalEntries).toBe('number')
    expect(body.totalEntries).toBeGreaterThan(0)
    expect(body.matches.length).toBeGreaterThan(0)
    expect(body.matches[0].entry.name).toBe('price-sentinel.agent.ts')
  })

  it('GET /internal/v1/codebase/query returns 400 when q is empty', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/v1/codebase/query',
      headers: { 'x-dataos-internal-key': KEY },
    })
    expect(res.statusCode).toBe(400)
  })

  it('GET /internal/v1/codebase/query returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/internal/v1/codebase/query?q=price+sentinel',
    })
    expect(res.statusCode).toBe(401)
  })

  it('POST /internal/v1/codebase/reindex rebuilds the index', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/v1/codebase/reindex',
      headers: { 'x-dataos-internal-key': KEY },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.entriesCount).toBe('number')
    expect(body.entriesCount).toBeGreaterThan(0)
    expect(typeof body.scannedAt).toBe('string')
  })

  it('POST /internal/v1/codebase/reindex returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/v1/codebase/reindex',
    })
    expect(res.statusCode).toBe(401)
  })
})

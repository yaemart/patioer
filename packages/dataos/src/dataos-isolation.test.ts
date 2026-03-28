import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool, QueryResult } from 'pg'
import type { Redis } from 'ioredis'
import { FeatureStoreService } from './feature-store.js'
import { DecisionMemoryService } from './decision-memory.js'
import { EventLakeService } from './event-lake.js'
import type { ProductFeaturesRow } from './types.js'

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function baseRow(tid: string, pid: string): ProductFeaturesRow {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    tenant_id: tid,
    platform: 'shopify',
    product_id: pid,
    price_current: '29.99',
    price_avg_30d: null,
    price_min_30d: null,
    price_max_30d: null,
    price_volatility: null,
    conv_rate_7d: '0.0200',
    conv_rate_30d: null,
    units_sold_7d: null,
    revenue_7d: null,
    rank_in_category: null,
    stock_qty: null,
    days_of_stock: null,
    reorder_point: null,
    competitor_min_price: null,
    competitor_avg_price: null,
    price_position: null,
    updated_at: new Date().toISOString(),
    deleted_at: null,
  }
}

describe('DataOS Three-Layer Tenant Isolation (AC-P3-18 / AC-P3-20)', () => {
  describe('Feature Store isolation', () => {
    let query: ReturnType<typeof vi.fn>
    let pool: Pool
    let redis: Redis
    let svc: FeatureStoreService

    beforeEach(() => {
      query = vi.fn()
      pool = { query } as unknown as Pool
      redis = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        setex: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
      } as unknown as Redis
      svc = new FeatureStoreService(pool, redis)
    })

    it('get() includes tenant_id in SQL query', async () => {
      query.mockResolvedValue({ rows: [baseRow(TENANT_A, 'P001')], rowCount: 1 })
      await svc.get(TENANT_A, 'shopify', 'P001', {
        cacheHit: vi.fn(),
        cacheMiss: vi.fn(),
      })
      const sql: string = query.mock.calls[0][0]
      expect(sql).toContain('tenant_id')
      const params: unknown[] = query.mock.calls[0][1]
      expect(params).toContain(TENANT_A)
    })

    it('get() uses tenant-scoped Redis key preventing cross-tenant cache leak', async () => {
      query.mockResolvedValue({ rows: [baseRow(TENANT_A, 'P001')], rowCount: 1 })
      await svc.get(TENANT_A, 'shopify', 'P001', {
        cacheHit: vi.fn(),
        cacheMiss: vi.fn(),
      })
      const redisKey: string = vi.mocked(redis.setex).mock.calls[0]?.[0] as string
      expect(redisKey).toContain(TENANT_A)
      expect(redisKey).not.toContain(TENANT_B)
    })

    it('list() SQL always includes tenant_id filter', async () => {
      query.mockResolvedValue({ rows: [] })
      await svc.list(TENANT_A)
      const sql: string = query.mock.calls[0][0]
      expect(sql).toContain('tenant_id = $1')
      expect(query.mock.calls[0][1][0]).toBe(TENANT_A)
    })
  })

  describe('Decision Memory isolation', () => {
    let query: ReturnType<typeof vi.fn>
    let pool: Pool
    let svc: DecisionMemoryService

    beforeEach(() => {
      query = vi.fn()
      pool = { query } as unknown as Pool
      delete process.env.OPENAI_API_KEY
      svc = new DecisionMemoryService(pool)
    })

    it('recall() filters by tenant_id — cross-tenant returns empty', async () => {
      query.mockResolvedValue({ rows: [] })
      await svc.recall(TENANT_A, 'price-sentinel', { price: 10 })
      const sql: string = query.mock.calls[0][0]
      const params: unknown[] = query.mock.calls[0][1]
      expect(sql).toContain('WHERE tenant_id = $1')
      expect(params[0]).toBe(TENANT_A)
    })

    it('record() stores tenant_id in the row', async () => {
      query.mockResolvedValue({ rows: [{ id: 'new-id' }] })
      await svc.record({
        tenantId: TENANT_A,
        agentId: 'price-sentinel',
        context: { price: 10 },
        action: { newPrice: 9 },
      })
      const params: unknown[] = query.mock.calls[0][1]
      expect(params[0]).toBe(TENANT_A)
    })

    it('writeOutcome() includes tenant_id in WHERE clause', async () => {
      query.mockResolvedValue({ rowCount: 1 } as QueryResult)
      await svc.writeOutcome('some-id', TENANT_A, { applied: true })
      const sql: string = query.mock.calls[0][0]
      expect(sql).toContain('tenant_id = $2')
      const params: unknown[] = query.mock.calls[0][1]
      expect(params[1]).toBe(TENANT_A)
    })

    it('delete() includes tenant_id guard — cannot delete cross-tenant (soft-delete)', async () => {
      query.mockResolvedValue({ rowCount: 0 } as QueryResult)
      const result = await svc.delete('some-id', TENANT_B)
      expect(result).toBe(false)
      const sql: string = query.mock.calls[0][0]
      expect(sql).toContain('tenant_id = $2')
      expect(sql).toContain('deleted_at = NOW()')
      expect(sql).not.toContain('DELETE FROM')
      expect(query.mock.calls[0][1][1]).toBe(TENANT_B)
    })

    it('listRecent() filters by tenant_id', async () => {
      query.mockResolvedValue({ rows: [] })
      await svc.listRecent(TENANT_A, 'price-sentinel')
      const params: unknown[] = query.mock.calls[0][1]
      expect(params[0]).toBe(TENANT_A)
    })
  })

  describe('Event Lake isolation', () => {
    it('queryEvents() includes tenantId in ClickHouse WHERE', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue([]),
        }),
      }
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      const internalClient = (svc as unknown as { client: typeof mockClient }).client
      Object.assign(internalClient, mockClient)

      await svc.queryEvents(TENANT_A, { limit: 10 })
      const sql: string = mockClient.query.mock.calls[0][0].query
      expect(sql).toContain('tenant_id')
    })

    it('insertEvent() passes tenantId as part of the row', async () => {
      const mockInsert = vi.fn().mockResolvedValue(undefined)
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      const internalClient = (svc as unknown as { client: { insert: typeof mockInsert } }).client
      internalClient.insert = mockInsert

      await svc.insertEvent({
        tenantId: TENANT_A,
        agentId: 'test',
        eventType: 'test',
        payload: {},
      })
      const insertCall = mockInsert.mock.calls[0][0]
      expect(insertCall.values[0].tenant_id).toBe(TENANT_A)
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventLakeService } from './event-lake.js'

const { insert, close, query } = vi.hoisted(() => ({
  insert: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  query: vi.fn(),
}))

vi.mock('@clickhouse/client', () => ({
  createClient: vi.fn(() => ({
    insert,
    close,
    query,
  })),
}))

describe('EventLakeService', () => {
  beforeEach(() => {
    insert.mockClear()
    close.mockClear()
    query.mockClear()
  })

  it('insertEvent calls client.insert with correct table and format', async () => {
    const svc = new EventLakeService({ url: 'http://localhost:8123' })
    await svc.insertEvent({
      tenantId: '00000000-0000-0000-0000-000000000001',
      agentId: 'agent-1',
      eventType: 'test',
      payload: 'plain',
    })
    expect(insert).toHaveBeenCalledTimes(1)
    const arg = insert.mock.calls[0][0] as {
      table: string
      format: string
      values: unknown[]
    }
    expect(arg.table).toBe('events')
    expect(arg.format).toBe('JSONEachRow')
    expect(Array.isArray(arg.values)).toBe(true)
  })

  it('insertEvent serializes object payload to JSON string', async () => {
    const svc = new EventLakeService({ url: 'http://localhost:8123' })
    await svc.insertEvent({
      tenantId: '00000000-0000-0000-0000-000000000001',
      agentId: 'a',
      eventType: 'e',
      payload: { foo: 'bar' },
      metadata: { trace: 1 },
    })
    const arg = insert.mock.calls[0][0] as {
      values: Array<{ payload: string; metadata: string }>
    }
    expect(arg.values[0].payload).toBe('{"foo":"bar"}')
    expect(arg.values[0].metadata).toBe('{"trace":1}')
  })

  it('insertPriceEvent maps approved boolean to UInt8', async () => {
    const svc = new EventLakeService({ url: 'http://localhost:8123' })
    await svc.insertPriceEvent({
      tenantId: '00000000-0000-0000-0000-000000000001',
      productId: 'p1',
      priceBefore: 10,
      priceAfter: 12,
      changePct: 0.2,
      approved: true,
    })
    let arg = insert.mock.calls[0][0] as {
      table: string
      values: Array<{ approved: number }>
    }
    expect(arg.table).toBe('price_events')
    expect(arg.values[0].approved).toBe(1)

    insert.mockClear()
    await svc.insertPriceEvent({
      tenantId: '00000000-0000-0000-0000-000000000001',
      productId: 'p1',
      priceBefore: 10,
      priceAfter: 9,
      changePct: -0.1,
      approved: false,
    })
    arg = insert.mock.calls[0][0] as {
      table: string
      values: Array<{ approved: number }>
    }
    expect(arg.values[0].approved).toBe(0)
  })

  it('close can be called multiple times', async () => {
    const svc = new EventLakeService({ url: 'http://localhost:8123' })
    await svc.close()
    await svc.close()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('insertPriceEventBatch inserts all rows in a single client.insert call', async () => {
    const svc = new EventLakeService({ url: 'http://localhost:8123' })
    await svc.insertPriceEventBatch([
      { tenantId: 't1', productId: 'p1', priceBefore: 10, priceAfter: 12, changePct: 0.2, approved: true },
      { tenantId: 't2', productId: 'p2', priceBefore: 20, priceAfter: 18, changePct: -0.1, approved: false },
    ])
    expect(insert).toHaveBeenCalledTimes(1)
    const arg = insert.mock.calls[0][0] as { table: string; values: Array<{ approved: number }> }
    expect(arg.table).toBe('price_events')
    expect(arg.values).toHaveLength(2)
    expect(arg.values[0].approved).toBe(1)
    expect(arg.values[1].approved).toBe(0)
  })

  describe('queryEvents()', () => {
    function mockQuery(rows: unknown[]) {
      query.mockResolvedValue({ json: vi.fn().mockResolvedValue(rows) })
    }

    it('queryEvents returns rows for tenant', async () => {
      const rows = [{ tenant_id: 't1', event_type: 'PRICE_CHANGED' }]
      mockQuery(rows)
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      const result = await svc.queryEvents('t1')
      expect(result).toEqual(rows)
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('queryEvents uses default limit 50 capped at 500', async () => {
      mockQuery([])
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      await svc.queryEvents('t1')
      const arg = query.mock.calls[0][0] as { query_params: { limit: number } }
      expect(arg.query_params.limit).toBe(50)
    })

    it('queryEvents caps limit at 500', async () => {
      mockQuery([])
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      await svc.queryEvents('t1', { limit: 9999 })
      const arg = query.mock.calls[0][0] as { query_params: { limit: number } }
      expect(arg.query_params.limit).toBe(500)
    })

    it('queryEvents filters by agentId, eventType, entityId', async () => {
      mockQuery([])
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      await svc.queryEvents('t1', { agentId: 'ag1', eventType: 'E', entityId: 'eid1' })
      const arg = query.mock.calls[0][0] as { query: string }
      expect(arg.query).toContain('agent_id')
      expect(arg.query).toContain('event_type')
      expect(arg.query).toContain('entity_id')
    })

    it('queryEvents filters by sinceMs', async () => {
      mockQuery([])
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      await svc.queryEvents('t1', { sinceMs: 1000000 })
      const arg = query.mock.calls[0][0] as { query: string }
      expect(arg.query).toContain('created_at >=')
    })
  })

  describe('queryPriceEvents()', () => {
    function mockQuery(rows: unknown[]) {
      query.mockResolvedValue({ json: vi.fn().mockResolvedValue(rows) })
    }

    it('queryPriceEvents returns rows for tenant', async () => {
      const rows = [{ tenant_id: 't1', product_id: 'p1' }]
      mockQuery(rows)
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      const result = await svc.queryPriceEvents('t1')
      expect(result).toEqual(rows)
    })

    it('queryPriceEvents filters by productId', async () => {
      mockQuery([])
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      await svc.queryPriceEvents('t1', { productId: 'p1' })
      const arg = query.mock.calls[0][0] as { query: string }
      expect(arg.query).toContain('product_id')
    })

    it('queryPriceEvents filters by sinceMs', async () => {
      mockQuery([])
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      await svc.queryPriceEvents('t1', { sinceMs: 1000000 })
      const arg = query.mock.calls[0][0] as { query: string }
      expect(arg.query).toContain('created_at >=')
    })
  })

  describe('aggregateRecentEntityEvents()', () => {
    function makeRows(n: number) {
      return Array.from({ length: n }, (_, i) => ({
        tenant_id: 't1',
        platform: 'shopify',
        product_id: `sku-${i + 1}`,
        evts: String(i + 1),
      }))
    }

    function mockQuery(rows: unknown[]) {
      query.mockResolvedValue({ json: vi.fn().mockResolvedValue(rows) })
    }

    it('aggregateRecentEntityEvents returns parsed rows', async () => {
      const rows = makeRows(3)
      mockQuery(rows)
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      const result = await svc.aggregateRecentEntityEvents()
      expect(result).toEqual(rows)
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('aggregateRecentEntityEvents uses default intervalDays=1 and limit=500', async () => {
      mockQuery([])
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      await svc.aggregateRecentEntityEvents()
      const arg = query.mock.calls[0][0] as { query_params: { days: number; limit: number } }
      expect(arg.query_params.days).toBe(1)
      expect(arg.query_params.limit).toBe(500)
    })

    it('aggregateRecentEntityEvents respects custom intervalDays and limit', async () => {
      mockQuery([])
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      await svc.aggregateRecentEntityEvents({ intervalDays: 7, limit: 100 })
      const arg = query.mock.calls[0][0] as { query_params: { days: number; limit: number } }
      expect(arg.query_params.days).toBe(7)
      expect(arg.query_params.limit).toBe(100)
    })

    it('aggregateRecentEntityEvents caps limit at 2000', async () => {
      mockQuery([])
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      await svc.aggregateRecentEntityEvents({ limit: 9999 })
      const arg = query.mock.calls[0][0] as { query_params: { limit: number } }
      expect(arg.query_params.limit).toBe(2000)
    })

    it('aggregateRecentEntityEvents groups by (tenant_id, platform, entity_id) — harness platform isolation', async () => {
      mockQuery([])
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      await svc.aggregateRecentEntityEvents()
      const arg = query.mock.calls[0][0] as { query: string }
      expect(arg.query).toContain('GROUP BY tenant_id, platform, entity_id')
    })

    it('aggregateRecentEntityEvents filters platform != empty — no unknown platform pollution', async () => {
      mockQuery([])
      const svc = new EventLakeService({ url: 'http://localhost:8123' })
      await svc.aggregateRecentEntityEvents()
      const arg = query.mock.calls[0][0] as { query: string }
      expect(arg.query).toContain("platform != ''")
    })
  })
})

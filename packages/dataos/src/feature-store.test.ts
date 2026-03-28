import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import { FeatureStoreService } from './feature-store.js'
import type { ProductFeaturesRow } from './types.js'

const TENANT = '00000000-0000-0000-0000-000000000001'
const PLATFORM = 'amazon'
const PRODUCT = 'sku-1'

function baseRow(overrides: Partial<ProductFeaturesRow> = {}): ProductFeaturesRow {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    tenant_id: TENANT,
    platform: PLATFORM,
    product_id: PRODUCT,
    price_current: '10.00',
    price_avg_30d: '9.50',
    price_min_30d: '8.00',
    price_max_30d: '11.00',
    price_volatility: '0.0500',
    conv_rate_7d: '0.0200',
    conv_rate_30d: '0.0180',
    units_sold_7d: 3,
    revenue_7d: '100.00',
    rank_in_category: 5,
    stock_qty: 20,
    days_of_stock: 10,
    reorder_point: 5,
    competitor_min_price: '9.00',
    competitor_avg_price: '10.50',
    price_position: 'mid',
    updated_at: '2025-01-01T12:00:00.000Z',
    deleted_at: null,
    ...overrides,
  }
}

describe('FeatureStoreService', () => {
  let query: ReturnType<typeof vi.fn>
  let pool: Pool
  let get: ReturnType<typeof vi.fn>
  let setex: ReturnType<typeof vi.fn>
  let redis: Redis

  beforeEach(() => {
    query = vi.fn()
    pool = { query } as unknown as Pool
    get = vi.fn()
    setex = vi.fn().mockResolvedValue('OK')
    redis = { get, setex } as unknown as Redis
  })

  it('get returns cached value when Redis has key', async () => {
    const row = baseRow()
    get.mockResolvedValue(JSON.stringify(row))
    const svc = new FeatureStoreService(pool, redis)
    const out = await svc.get(TENANT, PLATFORM, PRODUCT)
    expect(out).toEqual(row)
    expect(query).not.toHaveBeenCalled()
  })

  it('get queries PG and caches result when Redis misses', async () => {
    const row = baseRow()
    get.mockResolvedValue(null)
    query.mockResolvedValue({ rows: [row] })
    const svc = new FeatureStoreService(pool, redis)
    const out = await svc.get(TENANT, PLATFORM, PRODUCT)
    expect(out).toEqual(row)
    expect(query).toHaveBeenCalledTimes(1)
    expect(setex).toHaveBeenCalledWith(
      `dataos:feature:${TENANT}:${PLATFORM}:${PRODUCT}`,
      900,
      JSON.stringify(row),
    )
  })

  it('get returns null when product not found', async () => {
    get.mockResolvedValue(null)
    query.mockResolvedValue({ rows: [] })
    const svc = new FeatureStoreService(pool, redis)
    const out = await svc.get(TENANT, PLATFORM, PRODUCT)
    expect(out).toBeNull()
    expect(setex).not.toHaveBeenCalled()
  })

  it('upsert inserts new row and caches in Redis', async () => {
    const row = baseRow()
    query.mockResolvedValueOnce({ rows: [row] })
    const svc = new FeatureStoreService(pool, redis)
    await svc.upsert({
      tenantId: TENANT,
      platform: PLATFORM,
      productId: PRODUCT,
      priceCurrent: 10,
    })
    expect(query).toHaveBeenCalledTimes(1)
    const sql = String(query.mock.calls[0][0])
    expect(sql).toContain('INSERT INTO product_features')
    expect(sql).toContain('ON CONFLICT')
    expect(setex).toHaveBeenCalledWith(
      `dataos:feature:${TENANT}:${PLATFORM}:${PRODUCT}`,
      900,
      JSON.stringify(row),
    )
  })

  it('upsert updates existing row via ON CONFLICT', async () => {
    const rowV1 = baseRow({ price_current: '10.00' })
    const rowV2 = baseRow({ price_current: '12.00' })
    query
      .mockResolvedValueOnce({ rows: [rowV1] })
      .mockResolvedValueOnce({ rows: [rowV2] })
    const svc = new FeatureStoreService(pool, redis)
    await svc.upsert({
      tenantId: TENANT,
      platform: PLATFORM,
      productId: PRODUCT,
      priceCurrent: 10,
    })
    await svc.upsert({
      tenantId: TENANT,
      platform: PLATFORM,
      productId: PRODUCT,
      priceCurrent: 12,
    })
    expect(query).toHaveBeenCalledTimes(2)
    expect(setex).toHaveBeenLastCalledWith(
      `dataos:feature:${TENANT}:${PLATFORM}:${PRODUCT}`,
      900,
      JSON.stringify(rowV2),
    )
  })

  it('metrics.cacheHit called on Redis hit', async () => {
    const row = baseRow()
    get.mockResolvedValue(JSON.stringify(row))
    const cacheHit = vi.fn()
    const cacheMiss = vi.fn()
    const svc = new FeatureStoreService(pool, redis)
    await svc.get(TENANT, PLATFORM, PRODUCT, { cacheHit, cacheMiss })
    expect(cacheHit).toHaveBeenCalledTimes(1)
    expect(cacheMiss).not.toHaveBeenCalled()
  })

  it('metrics.cacheMiss called on Redis miss', async () => {
    get.mockResolvedValue(null)
    query.mockResolvedValue({ rows: [baseRow()] })
    const cacheHit = vi.fn()
    const cacheMiss = vi.fn()
    const svc = new FeatureStoreService(pool, redis)
    await svc.get(TENANT, PLATFORM, PRODUCT, { cacheHit, cacheMiss })
    expect(cacheMiss).toHaveBeenCalledTimes(1)
    expect(cacheHit).not.toHaveBeenCalled()
  })

  describe('multi-tenant isolation (Ch6.1 / AC-P3-18)', () => {
    const TENANT_A = '00000000-0000-0000-0000-000000000001'
    const TENANT_B = '00000000-0000-0000-0000-000000000002'

    it('get does not return data for a different tenant (Redis miss path)', async () => {
      get.mockResolvedValue(null)
      query.mockResolvedValue({ rows: [] })
      const svc = new FeatureStoreService(pool, redis)
      const result = await svc.get(TENANT_B, PLATFORM, PRODUCT)
      expect(result).toBeNull()
    })

    it('get uses tenant-scoped Redis cache key (tenant A key ≠ tenant B key)', async () => {
      const row = baseRow()
      get.mockImplementation((key: string) => {
        if (key === `dataos:feature:${TENANT_A}:${PLATFORM}:${PRODUCT}`) {
          return Promise.resolve(JSON.stringify(row))
        }
        return Promise.resolve(null)
      })
      query.mockResolvedValue({ rows: [] })
      const svc = new FeatureStoreService(pool, redis)
      const resultB = await svc.get(TENANT_B, PLATFORM, PRODUCT)
      expect(resultB).toBeNull()
      expect(query).toHaveBeenCalledTimes(1)
    })

    it('list SQL always includes tenant_id filter (Ch6.1 compliance)', async () => {
      query.mockResolvedValue({ rows: [] })
      const svc = new FeatureStoreService(pool, redis)
      await svc.list(TENANT_A)
      const sql = String(query.mock.calls[0][0])
      expect(sql).toContain('tenant_id = $1')
    })

    it('delete SQL always includes tenant_id filter (Ch6.1 compliance)', async () => {
      const del = vi.fn().mockResolvedValue(undefined)
      const isolatedRedis = { get, setex, del } as unknown as Redis
      query.mockResolvedValue({ rowCount: 0 })
      const svc = new FeatureStoreService(pool, isolatedRedis)
      await svc.delete(TENANT_A, PLATFORM, PRODUCT)
      const sql = String(query.mock.calls[0][0])
      expect(sql).toContain('tenant_id = $1')
      expect(sql).not.toContain('DELETE FROM')
    })
  })

  describe('Redis TTL precision', () => {
    it('get caches result with TTL=900 seconds', async () => {
      const row = baseRow()
      get.mockResolvedValue(null)
      query.mockResolvedValue({ rows: [row] })
      const svc = new FeatureStoreService(pool, redis)
      await svc.get(TENANT, PLATFORM, PRODUCT)
      expect(setex).toHaveBeenCalledWith(
        `dataos:feature:${TENANT}:${PLATFORM}:${PRODUCT}`,
        900,
        JSON.stringify(row),
      )
    })

    it('upsert caches updated row with TTL=900 seconds', async () => {
      const row = baseRow()
      query.mockResolvedValue({ rows: [row] })
      const svc = new FeatureStoreService(pool, redis)
      await svc.upsert({ tenantId: TENANT, platform: PLATFORM, productId: PRODUCT })
      expect(setex).toHaveBeenCalledWith(
        `dataos:feature:${TENANT}:${PLATFORM}:${PRODUCT}`,
        900,
        JSON.stringify(row),
      )
    })
  })

  describe('warmupCache()', () => {
    it('warmupCache loads top rows into Redis via pipeline', async () => {
      const rows = [baseRow(), baseRow({ product_id: 'sku-2' })]
      const setexPipeline = vi.fn()
      const execPipeline = vi.fn().mockResolvedValue([])
      const pipeline = { setex: setexPipeline, exec: execPipeline }
      const pipelineRedis = { get, setex, pipeline: vi.fn().mockReturnValue(pipeline) } as unknown as Redis
      query.mockResolvedValue({ rows })
      const svc = new FeatureStoreService(pool, pipelineRedis)
      const count = await svc.warmupCache(TENANT)
      expect(count).toBe(2)
      expect(setexPipeline).toHaveBeenCalledTimes(2)
      expect(execPipeline).toHaveBeenCalledTimes(1)
    })

    it('warmupCache returns 0 and skips pipeline when no rows found', async () => {
      const execPipeline = vi.fn()
      const pipeline = { setex: vi.fn(), exec: execPipeline }
      const pipelineRedis = { get, setex, pipeline: vi.fn().mockReturnValue(pipeline) } as unknown as Redis
      query.mockResolvedValue({ rows: [] })
      const svc = new FeatureStoreService(pool, pipelineRedis)
      const count = await svc.warmupCache(TENANT)
      expect(count).toBe(0)
      expect(execPipeline).not.toHaveBeenCalled()
    })
  })

  describe('list()', () => {
    it('list returns all features for tenant (no platform filter)', async () => {
      const rows = [baseRow(), baseRow({ product_id: 'sku-2' })]
      query.mockResolvedValue({ rows })
      const svc = new FeatureStoreService(pool, redis)
      const result = await svc.list(TENANT)
      expect(result).toEqual(rows)
      expect(query).toHaveBeenCalledTimes(1)
      const sql = String(query.mock.calls[0][0])
      expect(sql).toContain('tenant_id = $1')
    })

    it('list filters by platform when provided', async () => {
      const rows = [baseRow()]
      query.mockResolvedValue({ rows })
      const svc = new FeatureStoreService(pool, redis)
      const result = await svc.list(TENANT, PLATFORM)
      expect(result).toEqual(rows)
      const sql = String(query.mock.calls[0][0])
      expect(sql).toContain('platform = $2')
    })

    it('list respects limit and offset', async () => {
      query.mockResolvedValue({ rows: [] })
      const svc = new FeatureStoreService(pool, redis)
      await svc.list(TENANT, undefined, { limit: 10, offset: 5 })
      const params = query.mock.calls[0][1] as unknown[]
      expect(params).toContain(10)
      expect(params).toContain(5)
    })

    it('list returns empty array when no rows match', async () => {
      query.mockResolvedValue({ rows: [] })
      const svc = new FeatureStoreService(pool, redis)
      const result = await svc.list(TENANT)
      expect(result).toEqual([])
    })
  })

  describe('delete()', () => {
    let del: ReturnType<typeof vi.fn>

    beforeEach(() => {
      del = vi.fn().mockResolvedValue(undefined)
      redis = { get, setex, del } as unknown as Redis
    })

    it('delete returns true when row exists', async () => {
      query.mockResolvedValue({ rowCount: 1 })
      const svc = new FeatureStoreService(pool, redis)
      const result = await svc.delete(TENANT, PLATFORM, PRODUCT)
      expect(result).toBe(true)
    })

    it('delete returns false when row not found', async () => {
      query.mockResolvedValue({ rowCount: 0 })
      const svc = new FeatureStoreService(pool, redis)
      const result = await svc.delete(TENANT, PLATFORM, PRODUCT)
      expect(result).toBe(false)
    })

    it('delete invalidates Redis cache key', async () => {
      query.mockResolvedValue({ rowCount: 1 })
      const svc = new FeatureStoreService(pool, redis)
      await svc.delete(TENANT, PLATFORM, PRODUCT)
      expect(del).toHaveBeenCalledWith(`dataos:feature:${TENANT}:${PLATFORM}:${PRODUCT}`)
    })

    it('delete SQL always includes tenant_id filter (Ch6.1 compliance)', async () => {
      query.mockResolvedValue({ rowCount: 0 })
      const svc = new FeatureStoreService(pool, redis)
      await svc.delete(TENANT, PLATFORM, PRODUCT)
      const sql = String(query.mock.calls[0][0])
      expect(sql).toContain('tenant_id = $1')
      expect(sql).not.toContain('DELETE FROM')
    })

    it('delete uses soft-delete (UPDATE SET deleted_at) not hard-DELETE', async () => {
      query.mockResolvedValue({ rowCount: 1 })
      const svc = new FeatureStoreService(pool, redis)
      await svc.delete(TENANT, PLATFORM, PRODUCT)
      const sql = String(query.mock.calls[0][0])
      expect(sql).toContain('UPDATE product_features SET deleted_at = NOW()')
    })
  })
})

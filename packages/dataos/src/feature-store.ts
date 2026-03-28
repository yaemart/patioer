import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import type { ProductFeaturesRow } from './types.js'

const CACHE_TTL_SEC = 900

export interface FeatureStoreUpsertInput {
  tenantId: string
  platform: string
  productId: string
  priceCurrent?: number
  convRate7d?: number
  competitorMinPrice?: number
  competitorAvgPrice?: number
  pricePosition?: string
}

export class FeatureStoreService {
  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
  ) {}

  private cacheKey(tenantId: string, platform: string, productId: string): string {
    return `dataos:feature:${tenantId}:${platform}:${productId}`
  }

  async get(
    tenantId: string,
    platform: string,
    productId: string,
    metrics?: { cacheHit?: () => void; cacheMiss?: () => void },
  ): Promise<ProductFeaturesRow | null> {
    const key = this.cacheKey(tenantId, platform, productId)
    try {
      const cached = await this.redis.get(key)
      if (cached) {
        const parsed = JSON.parse(cached) as ProductFeaturesRow
        metrics?.cacheHit?.()
        return parsed
      }
    } catch {
      // Redis read or JSON parse failure — fall through to PostgreSQL
    }
    metrics?.cacheMiss?.()
    const { rows } = await this.pool.query<ProductFeaturesRow>(
      `SELECT * FROM product_features
       WHERE tenant_id = $1 AND platform = $2 AND product_id = $3 AND deleted_at IS NULL`,
      [tenantId, platform, productId],
    )
    const row = rows[0]
    if (row) {
      this.redis.setex(key, CACHE_TTL_SEC, JSON.stringify(row)).catch(() => {})
    }
    return row ?? null
  }

  async list(
    tenantId: string,
    platform?: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<ProductFeaturesRow[]> {
    const limit = Math.min(opts?.limit ?? 50, 500)
    const offset = opts?.offset ?? 0
    const params: unknown[] = [tenantId]
    const platformFilter = platform ? ` AND platform = $${params.push(platform)}` : ''
    const { rows } = await this.pool.query<ProductFeaturesRow>(
      `SELECT * FROM product_features WHERE tenant_id = $1 AND deleted_at IS NULL${platformFilter}
       ORDER BY updated_at DESC LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
      params,
    )
    return rows
  }

  async delete(tenantId: string, platform: string, productId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE product_features SET deleted_at = NOW()
       WHERE tenant_id = $1 AND platform = $2 AND product_id = $3 AND deleted_at IS NULL`,
      [tenantId, platform, productId],
    )
    await this.redis.del(this.cacheKey(tenantId, platform, productId))
    return (rowCount ?? 0) > 0
  }

  /**
   * Pre-load top-N recently-updated feature rows per tenant into Redis.
   * Called once on DataOS API startup to ensure cache is warm before first requests.
   * Addresses AC-P3-08: Redis cache hit rate > 90% requires pre-warming on startup.
   */
  async warmupCache(
    tenantId: string,
    platform?: string,
    opts?: { limit?: number },
  ): Promise<number> {
    const limit = Math.min(opts?.limit ?? 100, 500)
    const rows = await this.list(tenantId, platform, { limit })
    if (rows.length === 0) return 0
    const pipeline = this.redis.pipeline()
    for (const row of rows) {
      pipeline.setex(
        this.cacheKey(row.tenant_id, row.platform, row.product_id),
        CACHE_TTL_SEC,
        JSON.stringify(row),
      )
    }
    const results = await pipeline.exec()
    if (results) {
      for (const [err] of results) {
        if (err) {
          console.warn('[feature-store] warmupCache pipeline partial error', err.message)
          break
        }
      }
    }
    return rows.length
  }

  private static safeNum(v: number | undefined): number | null {
    return v !== undefined && Number.isFinite(v) ? v : null
  }

  async upsert(input: FeatureStoreUpsertInput): Promise<void> {
    const { rows } = await this.pool.query<ProductFeaturesRow>(
      `INSERT INTO product_features (
        tenant_id, platform, product_id,
        price_current, conv_rate_7d,
        competitor_min_price, competitor_avg_price, price_position
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (tenant_id, platform, product_id)
      DO UPDATE SET
        price_current = COALESCE(EXCLUDED.price_current, product_features.price_current),
        conv_rate_7d = COALESCE(EXCLUDED.conv_rate_7d, product_features.conv_rate_7d),
        competitor_min_price = COALESCE(EXCLUDED.competitor_min_price, product_features.competitor_min_price),
        competitor_avg_price = COALESCE(EXCLUDED.competitor_avg_price, product_features.competitor_avg_price),
        price_position = COALESCE(EXCLUDED.price_position, product_features.price_position),
        updated_at = NOW(),
        deleted_at = NULL
      RETURNING *`,
      [
        input.tenantId,
        input.platform,
        input.productId,
        FeatureStoreService.safeNum(input.priceCurrent),
        FeatureStoreService.safeNum(input.convRate7d),
        FeatureStoreService.safeNum(input.competitorMinPrice),
        FeatureStoreService.safeNum(input.competitorAvgPrice),
        input.pricePosition ?? null,
      ],
    )
    const row = rows[0]
    if (row) {
      this.redis.setex(
        this.cacheKey(input.tenantId, input.platform, input.productId),
        CACHE_TTL_SEC,
        JSON.stringify(row),
      ).catch(() => {})
    }
  }
}

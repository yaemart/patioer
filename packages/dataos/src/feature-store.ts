import type { Pool } from 'pg'
import { Redis } from 'ioredis'
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
    return `feature:${tenantId}:${platform}:${productId}`
  }

  async get(
    tenantId: string,
    platform: string,
    productId: string,
    metrics?: { cacheHit?: () => void; cacheMiss?: () => void },
  ): Promise<ProductFeaturesRow | null> {
    const key = this.cacheKey(tenantId, platform, productId)
    const cached = await this.redis.get(key)
    if (cached) {
      metrics?.cacheHit?.()
      return JSON.parse(cached) as ProductFeaturesRow
    }
    metrics?.cacheMiss?.()
    const { rows } = await this.pool.query<ProductFeaturesRow>(
      `SELECT * FROM product_features
       WHERE tenant_id = $1 AND platform = $2 AND product_id = $3`,
      [tenantId, platform, productId],
    )
    const row = rows[0]
    if (row) {
      await this.redis.setex(key, CACHE_TTL_SEC, JSON.stringify(row))
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
      `SELECT * FROM product_features WHERE tenant_id = $1${platformFilter}
       ORDER BY updated_at DESC LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
      params,
    )
    return rows
  }

  async delete(tenantId: string, platform: string, productId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM product_features WHERE tenant_id = $1 AND platform = $2 AND product_id = $3`,
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
    await pipeline.exec()
    return rows.length
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
        updated_at = NOW()
      RETURNING *`,
      [
        input.tenantId,
        input.platform,
        input.productId,
        input.priceCurrent ?? null,
        input.convRate7d ?? null,
        input.competitorMinPrice ?? null,
        input.competitorAvgPrice ?? null,
        input.pricePosition ?? null,
      ],
    )
    const row = rows[0]
    if (row) {
      await this.redis.setex(
        this.cacheKey(input.tenantId, input.platform, input.productId),
        CACHE_TTL_SEC,
        JSON.stringify(row),
      )
    }
  }
}

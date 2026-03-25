import type { Pool } from 'pg'
import { Redis } from 'ioredis'
import type { ProductFeaturesRow } from './types.js'

const CACHE_TTL_SEC = 900

export interface FeatureStoreUpsertInput {
  tenantId: string
  platform: string
  productId: string
  priceCurrent?: number
  priceAvg30d?: number
  priceMin30d?: number
  priceMax30d?: number
  priceVolatility?: number
  convRate7d?: number
  convRate30d?: number
  unitsSold7d?: number
  revenue7d?: number
  rankInCategory?: number
  stockQty?: number
  daysOfStock?: number
  reorderPoint?: number
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

  async upsert(input: FeatureStoreUpsertInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO product_features (
        tenant_id, platform, product_id,
        price_current, price_avg_30d, price_min_30d, price_max_30d, price_volatility,
        conv_rate_7d, conv_rate_30d, units_sold_7d, revenue_7d, rank_in_category,
        stock_qty, days_of_stock, reorder_point,
        competitor_min_price, competitor_avg_price, price_position
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      )
      ON CONFLICT (tenant_id, platform, product_id)
      DO UPDATE SET
        price_current = COALESCE(EXCLUDED.price_current, product_features.price_current),
        price_avg_30d = COALESCE(EXCLUDED.price_avg_30d, product_features.price_avg_30d),
        price_min_30d = COALESCE(EXCLUDED.price_min_30d, product_features.price_min_30d),
        price_max_30d = COALESCE(EXCLUDED.price_max_30d, product_features.price_max_30d),
        price_volatility = COALESCE(EXCLUDED.price_volatility, product_features.price_volatility),
        conv_rate_7d = COALESCE(EXCLUDED.conv_rate_7d, product_features.conv_rate_7d),
        conv_rate_30d = COALESCE(EXCLUDED.conv_rate_30d, product_features.conv_rate_30d),
        units_sold_7d = COALESCE(EXCLUDED.units_sold_7d, product_features.units_sold_7d),
        revenue_7d = COALESCE(EXCLUDED.revenue_7d, product_features.revenue_7d),
        rank_in_category = COALESCE(EXCLUDED.rank_in_category, product_features.rank_in_category),
        stock_qty = COALESCE(EXCLUDED.stock_qty, product_features.stock_qty),
        days_of_stock = COALESCE(EXCLUDED.days_of_stock, product_features.days_of_stock),
        reorder_point = COALESCE(EXCLUDED.reorder_point, product_features.reorder_point),
        competitor_min_price = COALESCE(EXCLUDED.competitor_min_price, product_features.competitor_min_price),
        competitor_avg_price = COALESCE(EXCLUDED.competitor_avg_price, product_features.competitor_avg_price),
        price_position = COALESCE(EXCLUDED.price_position, product_features.price_position),
        updated_at = NOW()`,
      [
        input.tenantId,
        input.platform,
        input.productId,
        input.priceCurrent ?? null,
        input.priceAvg30d ?? null,
        input.priceMin30d ?? null,
        input.priceMax30d ?? null,
        input.priceVolatility ?? null,
        input.convRate7d ?? null,
        input.convRate30d ?? null,
        input.unitsSold7d ?? null,
        input.revenue7d ?? null,
        input.rankInCategory ?? null,
        input.stockQty ?? null,
        input.daysOfStock ?? null,
        input.reorderPoint ?? null,
        input.competitorMinPrice ?? null,
        input.competitorAvgPrice ?? null,
        input.pricePosition ?? null,
      ],
    )
    const { rows } = await this.pool.query<ProductFeaturesRow>(
      `SELECT * FROM product_features WHERE tenant_id = $1 AND platform = $2 AND product_id = $3`,
      [input.tenantId, input.platform, input.productId],
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

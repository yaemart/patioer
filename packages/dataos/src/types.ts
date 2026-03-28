export interface DataOsEventLakeRecord {
  tenantId: string
  platform?: string
  agentId: string
  eventType: string
  entityId?: string
  payload: unknown
  metadata?: unknown
}

export interface DataOsPriceEventRecord {
  tenantId: string
  platform?: string
  productId: string
  priceBefore: number
  priceAfter: number
  changePct: number
  approved: boolean
  convRate7d?: number
  revenue7d?: number
}

export interface ProductFeaturesRow {
  id: string
  tenant_id: string
  platform: string
  product_id: string
  price_current: string | null
  price_avg_30d: string | null
  price_min_30d: string | null
  price_max_30d: string | null
  price_volatility: string | null
  conv_rate_7d: string | null
  conv_rate_30d: string | null
  units_sold_7d: number | null
  revenue_7d: string | null
  rank_in_category: number | null
  stock_qty: number | null
  days_of_stock: number | null
  reorder_point: number | null
  competitor_min_price: string | null
  competitor_avg_price: string | null
  price_position: string | null
  updated_at: string
  deleted_at: string | null
}

export interface DecisionMemoryRow {
  id: string
  tenant_id: string
  agent_id: string
  platform: string | null
  entity_id: string | null
  context: unknown
  action: unknown
  outcome: unknown | null
  decided_at: string
  outcome_at: string | null
  deleted_at: string | null
  similarity?: number
}

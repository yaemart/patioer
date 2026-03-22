/**
 * Flattened product representation used across all harness implementations.
 *
 * **Multi-variant limitation (Shopify):** `toProduct()` maps only the *first*
 * variant's price and inventory_quantity. Products with multiple variants will
 * have their additional variant data silently discarded. This is a known MVP
 * trade-off — full multi-variant support is tracked for a future sprint.
 */
/**
 * Flattened product representation used across all harness implementations.
 *
 * `price` and `inventory` are nullable — Amazon's Catalog Items API does not
 * return pricing or stock data, so those fields will be `null` until enriched
 * via the Listings or Inventory APIs.
 */
export interface Product {
  id: string
  title: string
  price: number | null
  inventory: number | null
  variantCount?: number
  sku?: string
  currency?: string
  platformMeta?: Record<string, unknown>
}

export interface Order {
  id: string
  status: string
  totalPrice: number
}

export interface Thread {
  id: string
  subject: string
}

export interface DateRange {
  from: Date
  to: Date
}

export interface Analytics {
  revenue: number
  orders: number
  truncated?: boolean
}

export interface PaginationOpts {
  cursor?: string
  limit?: number
}

export interface PaginatedResult<T> {
  items: T[]
  nextCursor?: string
}

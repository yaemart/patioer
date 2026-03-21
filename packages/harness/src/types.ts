/**
 * Flattened product representation used across all harness implementations.
 *
 * **Multi-variant limitation (Shopify):** `toProduct()` maps only the *first*
 * variant's price and inventory_quantity. Products with multiple variants will
 * have their additional variant data silently discarded. This is a known MVP
 * trade-off — full multi-variant support is tracked for a future sprint.
 */
export interface Product {
  id: string
  title: string
  price: number
  inventory: number
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
}

export interface PaginationOpts {
  cursor?: string
  limit?: number
}

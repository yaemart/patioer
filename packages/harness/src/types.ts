/**
 * Flattened product representation used across all harness implementations.
 *
 * **Shopify:** `toProduct()` maps only the *first* variant's price and
 * `inventory_quantity`; multi-variant products lose extra variant rows (MVP trade-off).
 *
 * **Amazon:** Catalog Items often leaves `price` and `inventory` as `null` until
 * enriched via Listings or Inventory APIs.
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

/**
 * Aggregated sales metrics for a date range.
 *
 * **`truncated`:** when `true`, the implementation **stopped after a single page**
 * of orders (or hit an internal cap) and **revenue / orders are lower bounds** —
 * not a full-range rollup. When `false` or omitted, numbers reflect all orders
 * the harness pulled for that range (per-platform page limits still apply; see
 * each harness’s `getAnalytics`). Do **not** treat `truncated: true` as “complete”
 * for finance or ops reporting without fetching additional pages or using platform reports.
 */
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

// ─── Phase 2: Multi-platform HarnessRegistry types ────────────────────────────
// Day 1: interface design → Day 6 (Sprint 3): full implementation in harness.registry.ts

/** All platforms supported by the HarnessRegistry. */
export type Platform = 'shopify' | 'amazon' | 'tiktok' | 'shopee' | 'walmart' | 'b2b'

/**
 * Factory function signature used to instantiate a TenantHarness on demand.
 * Registered per-platform via `registerHarnessFactory(platform, factory)`.
 */
export type HarnessFactory = (tenantId: string) => import('./base.harness.js').TenantHarness

/**
 * Composite cache key used internally by HarnessRegistry.
 * Format: `${tenantId}:${platform}`
 */
export type RegistryKey = `${string}:${Platform}`

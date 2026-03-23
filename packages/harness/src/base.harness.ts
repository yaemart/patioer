import type {
  Analytics,
  DateRange,
  PaginatedResult,
  PaginationOpts,
  Order,
  Product,
  Thread,
} from './types.js'

export interface TenantHarness {
  readonly tenantId: string
  readonly platformId: string

  getProduct(productId: string): Promise<Product | null>
  getProductsPage(opts?: PaginationOpts): Promise<PaginatedResult<Product>>
  /**
   * Returns a single page of products. When the result is truncated (more products available),
   * the returned array has `.truncated = true`. Use `getProductsPage` with cursors for full iteration.
   */
  getProducts(opts?: PaginationOpts): Promise<Product[] & { truncated?: boolean }>
  updatePrice(productId: string, price: number): Promise<void>

  /**
   * Sets absolute inventory level for a product.
   *
   * Extension note: this method accepts a product-level `qty` argument
   * rather than a Shopify-specific (inventoryItemId, locationId) pair.
   * The harness implementation resolves the platform-specific identifiers
   * internally. This differs from the Constitution v0.1 draft that used
   * raw Shopify parameters — the abstraction was intentionally raised so
   * callers remain platform-agnostic.
   */
  updateInventory(productId: string, qty: number): Promise<void>

  getOrdersPage(opts?: PaginationOpts): Promise<PaginatedResult<Order>>
  getOrders(opts?: PaginationOpts): Promise<Order[]>

  replyToMessage(threadId: string, body: string): Promise<void>
  getOpenThreads(): Promise<Thread[]>

  /**
   * Revenue and order counts for `range`. See {@link Analytics} for the meaning of `truncated`.
   */
  getAnalytics(range: DateRange): Promise<Analytics>
}

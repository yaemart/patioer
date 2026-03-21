import type {
  Analytics,
  DateRange,
  PaginationOpts,
  Order,
  Product,
  Thread,
} from './types.js'

export interface TenantHarness {
  readonly tenantId: string
  readonly platformId: string

  getProducts(opts?: PaginationOpts): Promise<Product[]>
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

  getOrders(opts?: PaginationOpts): Promise<Order[]>

  replyToMessage(threadId: string, body: string): Promise<void>
  getOpenThreads(): Promise<Thread[]>

  getAnalytics(range: DateRange): Promise<Analytics>
}

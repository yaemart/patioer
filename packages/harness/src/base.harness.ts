import type {
  Analytics,
  DateRange,
  GetOrdersOpts,
  GetProductsOpts,
  Order,
  Product,
  Thread,
} from './types.js'

export interface PlatformHarness {
  readonly platformId: string

  getProducts(opts?: GetProductsOpts): Promise<Product[]>
  updatePrice(productId: string, price: number): Promise<void>
  updateInventory(productId: string, qty: number): Promise<void>

  getOrders(opts?: GetOrdersOpts): Promise<Order[]>

  replyToMessage(threadId: string, body: string): Promise<void>
  getOpenThreads(): Promise<Thread[]>

  getAnalytics(range: DateRange): Promise<Analytics>
}

export interface TenantHarness extends PlatformHarness {
  tenantId: string
}

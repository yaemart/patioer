import type { TenantHarness } from './base.harness.js'
import type {
  Analytics,
  DateRange,
  GetOrdersOpts,
  GetProductsOpts,
  Order,
  Product,
  Thread,
} from './types.js'

export class ShopifyHarness implements TenantHarness {
  readonly platformId = 'shopify'

  constructor(
    readonly tenantId: string,
    private readonly shopDomain: string,
    private readonly accessToken: string,
  ) {}

  async getProducts(_opts?: GetProductsOpts): Promise<Product[]> {
    return []
  }

  async updatePrice(_productId: string, _price: number): Promise<void> {
    return
  }

  async updateInventory(_productId: string, _qty: number): Promise<void> {
    return
  }

  async getOrders(_opts?: GetOrdersOpts): Promise<Order[]> {
    return []
  }

  async replyToMessage(_threadId: string, _body: string): Promise<void> {
    return
  }

  async getOpenThreads(): Promise<Thread[]> {
    return []
  }

  async getAnalytics(_range: DateRange): Promise<Analytics> {
    return { revenue: 0, orders: 0 }
  }
}

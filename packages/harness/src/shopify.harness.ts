import type { TenantHarness } from './base.harness.js'
import { HarnessError } from './harness-error.js'
import type {
  Analytics,
  DateRange,
  PaginationOpts,
  Order,
  Product,
  Thread,
} from './types.js'

const SHOPIFY_API_VERSION = '2024-01'

// --- Internal Shopify REST response types ---

interface ShopifyVariant {
  id: number
  price: string
  inventory_quantity: number
  inventory_item_id: number
}

interface ShopifyProduct {
  id: number
  title: string
  variants: ShopifyVariant[]
}

interface ShopifyOrder {
  id: number
  financial_status: string
  total_price: string
}

interface ShopifyLocation {
  id: number
}

// --- Domain mapping helpers ---
// See Product JSDoc in types.ts for the multi-variant limitation.

const toProduct = (p: ShopifyProduct): Product => ({
  id: String(p.id),
  title: p.title,
  price: parseFloat(p.variants[0]?.price ?? '0'),
  inventory: p.variants[0]?.inventory_quantity ?? 0,
})

const toOrder = (o: ShopifyOrder): Order => ({
  id: String(o.id),
  status: o.financial_status,
  totalPrice: parseFloat(o.total_price),
})

// --- Token-bucket rate limiter (2 req/s) ---
// Buckets are shared across all ShopifyHarness instances for the same shop
// so concurrent requests (e.g. product sync + agent heartbeat) cannot
// collectively exceed Shopify's 2 req/s sustained limit.

class TokenBucket {
  private tokens: number
  private lastRefillMs: number

  constructor(
    private readonly capacity: number,
    private readonly refillRatePerSecond: number,
  ) {
    this.tokens = capacity
    this.lastRefillMs = Date.now()
  }

  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now()
      const elapsed = (now - this.lastRefillMs) / 1000
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRatePerSecond)
      this.lastRefillMs = now

      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }

      const waitMs = Math.ceil(((1 - this.tokens) / this.refillRatePerSecond) * 1000)
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
    }
  }
}

const sharedBuckets = new Map<string, TokenBucket>()

function getBucket(shopDomain: string): TokenBucket {
  let bucket = sharedBuckets.get(shopDomain)
  if (!bucket) {
    bucket = new TokenBucket(2, 2)
    sharedBuckets.set(shopDomain, bucket)
  }
  return bucket
}

// --- Retry with exponential back-off for 429 / 5xx ---

const MAX_RETRIES = 3
const BASE_DELAY_MS = 500

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// --- ShopifyHarness ---

export class ShopifyHarness implements TenantHarness {
  readonly platformId = 'shopify'
  private readonly bucket: TokenBucket
  private readonly baseUrl: string

  constructor(
    readonly tenantId: string,
    private readonly shopDomain: string,
    private readonly accessToken: string,
  ) {
    this.bucket = getBucket(shopDomain)
    this.baseUrl = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}`
  }

  private async shopifyFetch<T>(path: string, init?: RequestInit): Promise<T> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.bucket.acquire()
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'X-Shopify-Access-Token': this.accessToken,
          'Content-Type': 'application/json',
          ...(init?.headers as Record<string, string> | undefined),
        },
      })

      if (res.ok) {
        return res.json() as Promise<T>
      }

      const isRetryable = res.status === 429 || res.status >= 500
      if (isRetryable && attempt < MAX_RETRIES) {
        const retryAfterHeader = res.headers.get('retry-after')
        const delayMs = retryAfterHeader
          ? parseFloat(retryAfterHeader) * 1000
          : BASE_DELAY_MS * 2 ** attempt
        await sleep(delayMs)
        continue
      }

      throw new HarnessError('shopify', String(res.status), `Shopify API error ${res.status} ${res.statusText} for ${path}`)
    }

    throw new HarnessError('shopify', 'max_retries', `Shopify API: max retries exceeded for ${path}`)
  }

  async getProducts(opts?: PaginationOpts): Promise<Product[]> {
    const params = new URLSearchParams({ limit: String(opts?.limit ?? 50) })
    if (opts?.cursor) params.set('page_info', opts.cursor)
    const data = await this.shopifyFetch<{ products: ShopifyProduct[] }>(
      `/products.json?${params}`,
    )
    return data.products.map(toProduct)
  }

  async updatePrice(productId: string, price: number): Promise<void> {
    // Fetch product to resolve the default variant id
    const data = await this.shopifyFetch<{ product: ShopifyProduct }>(
      `/products/${productId}.json?fields=id,variants`,
    )
    const variantId = data.product.variants[0]?.id
    if (!variantId) {
      throw new Error(`No variant found for product ${productId}`)
    }
    await this.shopifyFetch(`/variants/${variantId}.json`, {
      method: 'PUT',
      body: JSON.stringify({ variant: { id: variantId, price: price.toFixed(2) } }),
    })
  }

  async updateInventory(productId: string, qty: number): Promise<void> {
    const productData = await this.shopifyFetch<{ product: ShopifyProduct }>(
      `/products/${productId}.json?fields=id,variants`,
    )
    const variant = productData.product.variants[0]
    if (!variant) {
      throw new Error(`No variant found for product ${productId}`)
    }

    // Resolve default fulfillment location
    const locationData = await this.shopifyFetch<{ locations: ShopifyLocation[] }>(
      '/locations.json',
    )
    const locationId = locationData.locations[0]?.id
    if (!locationId) {
      throw new Error('No Shopify fulfillment location found')
    }

    await this.shopifyFetch('/inventory_levels/set.json', {
      method: 'POST',
      body: JSON.stringify({
        location_id: locationId,
        inventory_item_id: variant.inventory_item_id,
        available: qty,
      }),
    })
  }

  async getOrders(opts?: PaginationOpts): Promise<Order[]> {
    const params = new URLSearchParams({
      status: 'any',
      limit: String(opts?.limit ?? 50),
    })
    if (opts?.cursor) params.set('page_info', opts.cursor)
    const data = await this.shopifyFetch<{ orders: ShopifyOrder[] }>(`/orders.json?${params}`)
    return data.orders.map(toOrder)
  }

  async replyToMessage(_threadId: string, _body: string): Promise<void> {
    // Shopify Inbox is a separate product outside the standard REST Admin API.
    // Full implementation requires the Shopify Inbox OAuth scope + dedicated integration.
    console.warn(
      `[ShopifyHarness] replyToMessage: Shopify Inbox API not wired in MVP (thread=${_threadId})`,
    )
  }

  async getOpenThreads(): Promise<Thread[]> {
    // Shopify Inbox is a separate product outside the standard REST Admin API.
    // Full implementation requires the Shopify Inbox OAuth scope + dedicated integration.
    console.warn('[ShopifyHarness] getOpenThreads: Shopify Inbox API not wired in MVP')
    return []
  }

  async getAnalytics(range: DateRange): Promise<Analytics> {
    // MVP: fetches at most 250 orders per call (Shopify REST max page size).
    // Revenue will be under-reported if > 250 paid orders exist in the range.
    // TODO: implement Link-header pagination to aggregate all pages.
    const PAGE_LIMIT = 250
    const params = new URLSearchParams({
      status: 'paid',
      created_at_min: range.from.toISOString(),
      created_at_max: range.to.toISOString(),
      limit: String(PAGE_LIMIT),
      fields: 'total_price',
    })
    const data = await this.shopifyFetch<{ orders: Array<{ total_price: string }> }>(
      `/orders.json?${params}`,
    )
    if (data.orders.length >= PAGE_LIMIT) {
      console.warn(
        `[ShopifyHarness] getAnalytics: hit ${PAGE_LIMIT}-order page limit; revenue may be under-reported`,
      )
    }
    const revenue = data.orders.reduce((sum, o) => sum + parseFloat(o.total_price), 0)
    return { revenue, orders: data.orders.length }
  }
}

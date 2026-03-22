import type { TenantHarness } from './base.harness.js'
import { HarnessError, httpStatusToCode } from './harness-error.js'
import { TokenBucket, getSharedBucket, jitteredBackoff, sleep } from './token-bucket.js'
import type {
  Analytics,
  DateRange,
  PaginatedResult,
  PaginationOpts,
  Order,
  Product,
  Thread,
} from './types.js'

const SHOPIFY_API_VERSION = '2024-01'

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

const toProduct = (p: ShopifyProduct): Product => ({
  id: String(p.id),
  title: p.title,
  price: parseFloat(p.variants[0]?.price ?? '0'),
  inventory: p.variants[0]?.inventory_quantity ?? 0,
  variantCount: p.variants.length,
})

const toOrder = (o: ShopifyOrder): Order => ({
  id: String(o.id),
  status: o.financial_status,
  totalPrice: parseFloat(o.total_price),
})

const MAX_RETRIES = 3
const BASE_DELAY_MS = 500
const FETCH_TIMEOUT_MS = 15_000

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
    this.bucket = getSharedBucket(shopDomain, { capacity: 2, refillRatePerSecond: 2 })
    this.baseUrl = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}`
  }

  private async shopifyFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const result = await this.shopifyFetchWithMeta<T>(path, init)
    return result.data
  }

  private async shopifyFetchWithMeta<T>(
    path: string,
    init?: RequestInit,
  ): Promise<{ data: T; headers: Headers }> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.bucket.acquire()
      let res: Response
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          ...init,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: {
            'X-Shopify-Access-Token': this.accessToken,
            'Content-Type': 'application/json',
            ...(init?.headers as Record<string, string> | undefined),
          },
        })
      } catch (error) {
        const isNetworkError = error instanceof Error
        if (isNetworkError && attempt < MAX_RETRIES) {
          await sleep(jitteredBackoff(attempt, BASE_DELAY_MS))
          continue
        }
        throw new HarnessError(
          'shopify',
          'network_error',
          `Shopify network error for ${path}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      if (res.ok) {
        let data: T
        try {
          data = (await res.json()) as T
        } catch {
          throw new HarnessError('shopify', 'json_parse_error', `Shopify returned non-JSON response for ${path}`)
        }
        return { data, headers: res.headers }
      }

      const isRetryable = res.status === 429 || res.status >= 500
      if (isRetryable && attempt < MAX_RETRIES) {
        const retryAfterHeader = res.headers.get('retry-after')
        const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN
        const delayMs =
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
            ? retryAfterSeconds * 1000
            : jitteredBackoff(attempt, BASE_DELAY_MS)
        await sleep(delayMs)
        continue
      }

      throw new HarnessError('shopify', httpStatusToCode(res.status), `Shopify API error ${res.status} ${res.statusText} for ${path}`)
    }

    throw new HarnessError('shopify', 'max_retries', `Shopify API: max retries exceeded for ${path}`)
  }

  private extractNextCursor(linkHeader: string | null): string | undefined {
    if (!linkHeader) return undefined
    const parts = linkHeader.split(',')
    const next = parts.find((part) => part.includes('rel="next"'))
    if (!next) return undefined
    const match = next.match(/<([^>]+)>/)
    if (!match) return undefined
    try {
      const url = new URL(match[1]!)
      return url.searchParams.get('page_info') ?? undefined
    } catch {
      return undefined
    }
  }

  async getProduct(productId: string): Promise<Product | null> {
    try {
      const data = await this.shopifyFetch<{ product: ShopifyProduct }>(
        `/products/${productId}.json`,
      )
      return toProduct(data.product)
    } catch (err) {
      if (err instanceof HarnessError && err.code === '404') return null
      throw err
    }
  }

  async getProductsPage(opts?: PaginationOpts): Promise<PaginatedResult<Product>> {
    const params = new URLSearchParams({ limit: String(opts?.limit ?? 50) })
    if (opts?.cursor) params.set('page_info', opts.cursor)
    const { data, headers } = await this.shopifyFetchWithMeta<{ products: ShopifyProduct[] }>(
      `/products.json?${params}`,
    )
    return {
      items: data.products.map(toProduct),
      nextCursor: this.extractNextCursor(headers.get('link')),
    }
  }

  async getProducts(opts?: PaginationOpts): Promise<Product[]> {
    const page = await this.getProductsPage(opts)
    return page.items
  }

  async updatePrice(productId: string, price: number): Promise<void> {
    // Fetch product to resolve the default variant id
    const data = await this.shopifyFetch<{ product: ShopifyProduct }>(
      `/products/${productId}.json?fields=id,variants`,
    )
    const variantId = data.product.variants[0]?.id
    if (!variantId) {
      throw new HarnessError('shopify', 'variant_not_found', `No variant found for product ${productId}`)
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
      throw new HarnessError('shopify', 'variant_not_found', `No variant found for product ${productId}`)
    }

    // Resolve default fulfillment location
    const locationData = await this.shopifyFetch<{ locations: ShopifyLocation[] }>(
      '/locations.json',
    )
    const locationId = locationData.locations[0]?.id
    if (!locationId) {
      throw new HarnessError('shopify', 'location_not_found', 'No Shopify fulfillment location found')
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

  async getOrdersPage(opts?: PaginationOpts): Promise<PaginatedResult<Order>> {
    const params = new URLSearchParams({
      status: 'any',
      limit: String(opts?.limit ?? 50),
    })
    if (opts?.cursor) params.set('page_info', opts.cursor)
    const { data, headers } = await this.shopifyFetchWithMeta<{ orders: ShopifyOrder[] }>(
      `/orders.json?${params}`,
    )
    return {
      items: data.orders.map(toOrder),
      nextCursor: this.extractNextCursor(headers.get('link')),
    }
  }

  async getOrders(opts?: PaginationOpts): Promise<Order[]> {
    const page = await this.getOrdersPage(opts)
    return page.items
  }

  async replyToMessage(_threadId: string, _body: string): Promise<void> {
    // Shopify Inbox is a separate product outside the standard REST Admin API.
    // Full implementation requires the Shopify Inbox OAuth scope + dedicated integration.
    throw new HarnessError(
      'shopify',
      'not_implemented',
      `Shopify Inbox API not wired in MVP (thread=${_threadId})`,
    )
  }

  async getOpenThreads(): Promise<Thread[]> {
    // Shopify Inbox is a separate product outside the standard REST Admin API.
    // Full implementation requires the Shopify Inbox OAuth scope + dedicated integration.
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
    const revenue = data.orders.reduce((sum, o) => sum + parseFloat(o.total_price), 0)
    return {
      revenue,
      orders: data.orders.length,
      truncated: data.orders.length >= PAGE_LIMIT,
    }
  }
}

import type { TenantHarness } from './base.harness.js'
import { HarnessError, httpStatusToCode } from './harness-error.js'
import type {
  Analytics,
  DateRange,
  Order,
  PaginatedResult,
  PaginationOpts,
  Product,
  Thread,
} from './types.js'
import type {
  AmazonCatalogItemSummary,
  AmazonCredentials,
  AmazonLwaTokenResponse,
  AmazonOrderSummary,
} from './amazon.types.js'

import { TokenBucket, getSharedBucket, jitteredBackoff, sleep } from './token-bucket.js'

const AMAZON_SP_API_BASE_URL: Record<AmazonCredentials['region'], string> = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
}

/**
 * Canonical marketplace → ISO 4217 currency mapping.
 * Source: Amazon SP-API Marketplace IDs reference (2024).
 * Used by normalizeAmazonProduct and buildPricePatch to avoid hardcoding USD.
 */
const MARKETPLACE_CURRENCY: Record<string, string> = {
  ATVPDKIKX0DER: 'USD', // US
  A2EUQ1WTGCTBG2: 'CAD', // Canada
  A1F83G8C2ARO7P: 'GBP', // UK
  A13V1IB3VIYZZH: 'EUR', // France
  A1PA6795UKMFR9: 'EUR', // Germany
  APJ6JRA9NG5V4:  'EUR', // Italy
  A1RKKUPIHCS9HS: 'EUR', // Spain
  A1805IZSGTT6HS: 'EUR', // Netherlands
  A2NODRKZP88ZB9: 'SEK', // Sweden
  A33AVAJ2PDY3EV: 'TRY', // Turkey
  A19VAU5U5O7RUS: 'SGD', // Singapore
  A39IBJ37TRP1C6: 'AUD', // Australia
  A1VC38T7YXB528: 'JPY', // Japan
  A21TJRUUN4KGV:  'INR', // India
  AAHKV2X7AFYLW: 'CNY', // China
  A2Q3Y263D00KWC: 'BRL', // Brazil
  A1AM78C64UM0Y8: 'MXN', // Mexico
} as const

const AMAZON_SP_API_SANDBOX_URL: Record<AmazonCredentials['region'], string> = {
  na: 'https://sandbox.sellingpartnerapi-na.amazon.com',
  eu: 'https://sandbox.sellingpartnerapi-eu.amazon.com',
  fe: 'https://sandbox.sellingpartnerapi-fe.amazon.com',
}

const AMAZON_LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'
const ACCESS_TOKEN_SKEW_MS = 60_000
const MAX_RETRIES = 5
const BASE_DELAY_MS = 500
const FETCH_TIMEOUT_MS = 15_000

const AMAZON_API_FAMILIES: Record<string, { capacity: number; refillRate: number }> = {
  '/catalog/':   { capacity: 2, refillRate: 2 },
  '/listings/':  { capacity: 5, refillRate: 5 },
  '/orders/':    { capacity: 1, refillRate: 0.5 },
  '/reports/':   { capacity: 1, refillRate: 0.5 },
  '/messaging/': { capacity: 1, refillRate: 1 },
}
const AMAZON_DEFAULT_BUCKET_CONFIG = { capacity: 2, refillRate: 2 }

interface AmazonRequestInit extends RequestInit {
  query?: Record<string, string | undefined>
}

interface AmazonCatalogSearchResponse {
  items?: AmazonCatalogItemSummary[]
  pagination?: { nextToken?: string }
}

interface AmazonOrdersResponse {
  payload?: {
    Orders?: AmazonOrderSummary[]
    NextToken?: string
  }
}

function normalizeAmazonProduct(
  item: AmazonCatalogItemSummary,
  marketplaceId: string,
): Product {
  return {
    id: item.asin,
    title: item.title ?? item.asin,
    price: null,
    inventory: null,
    sku: item.sku,
    currency: MARKETPLACE_CURRENCY[marketplaceId],
    platformMeta: { platform: 'amazon', asin: item.asin, source: 'catalog-items' },
  }
}

function normalizeAmazonOrder(order: AmazonOrderSummary): Order {
  return {
    id: order.AmazonOrderId,
    status: order.OrderStatus,
    totalPrice: Number(order.OrderTotal?.Amount ?? 0),
  }
}

export class AmazonHarness implements TenantHarness {
  readonly platformId = 'amazon'
  private readonly baseUrl: string

  private accessToken?: string
  private tokenExpiresAt = 0
  // Deduplicates concurrent token-refresh calls so N parallel requests
  // only trigger a single LWA round-trip instead of N (thundering herd).
  private refreshPromise: Promise<void> | null = null

  constructor(
    readonly tenantId: string,
    private readonly credentials: AmazonCredentials,
  ) {
    // useSandbox defaults to true so sandbox is always the safe default.
    // Pass useSandbox: false (or set AMAZON_USE_SANDBOX=false) for production.
    const sandbox = credentials.useSandbox !== false
    this.baseUrl = sandbox
      ? AMAZON_SP_API_SANDBOX_URL[credentials.region]
      : AMAZON_SP_API_BASE_URL[credentials.region]
  }

  private getApiBucket(path: string): TokenBucket {
    const family =
      Object.keys(AMAZON_API_FAMILIES).find((prefix) => path.includes(prefix)) ?? '/default/'
    const config = AMAZON_API_FAMILIES[family] ?? AMAZON_DEFAULT_BUCKET_CONFIG
    const bucketKey = `amazon:${this.credentials.sellerId}:${family}`
    return getSharedBucket(bucketKey, { capacity: config.capacity, refillRatePerSecond: config.refillRate })
  }

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(path, this.baseUrl)
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value)
        }
      }
    }
    return url.toString()
  }

  private async refreshAccessToken(): Promise<void> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.credentials.refreshToken,
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
    })

    const response = await fetch(AMAZON_LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    if (!response.ok) {
      throw new HarnessError(
        'amazon',
        'auth_failed',
        `Amazon LWA token refresh failed: ${response.status} ${response.statusText}`,
      )
    }

    const token = (await response.json()) as AmazonLwaTokenResponse
    if (!token.access_token || !token.expires_in) {
      throw new HarnessError('amazon', 'auth_failed', 'Amazon LWA token payload is invalid')
    }

    this.accessToken = token.access_token
    this.tokenExpiresAt = Date.now() + Math.max(token.expires_in * 1000 - ACCESS_TOKEN_SKEW_MS, 1_000)
  }

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken
    }

    // Merge all concurrent callers into a single in-flight refresh request.
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshAccessToken().finally(() => {
        this.refreshPromise = null
      })
    }
    await this.refreshPromise

    if (!this.accessToken) {
      throw new HarnessError('amazon', 'auth_failed', 'Amazon LWA token refresh returned empty token')
    }
    return this.accessToken
  }

  private async amazonFetch<T>(path: string, init?: AmazonRequestInit): Promise<T> {
    const token = await this.ensureAccessToken()
    const url = this.buildUrl(path, init?.query)
    const bucket = this.getApiBucket(path)

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      await bucket.acquire()

      let response: Response
      try {
        response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: {
            'Content-Type': 'application/json',
            'x-amz-access-token': token,
            ...(init?.headers as Record<string, string> | undefined),
          },
        })
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          await sleep(jitteredBackoff(attempt, BASE_DELAY_MS))
          continue
        }
        throw new HarnessError(
          'amazon',
          'network_error',
          `Amazon network error for ${path}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      if (response.ok) {
        if (response.status === 204) {
          return undefined as T
        }
        let data: T
        try {
          data = (await response.json()) as T
        } catch {
          throw new HarnessError('amazon', 'json_parse_error', `Amazon returned non-JSON response for ${path}`)
        }
        return data
      }

      if (response.status === 429 && attempt < MAX_RETRIES) {
        const limitHeader = response.headers.get('x-amzn-RateLimit-Limit')
        const rateLimit = limitHeader !== null ? Number(limitHeader) : 0
        // header gives allowed req/s; convert to minimum interval ms
        const headerDelayMs = rateLimit > 0 ? Math.ceil(1000 / rateLimit) : 0
        await sleep(Math.max(headerDelayMs, jitteredBackoff(attempt, BASE_DELAY_MS)))
        continue
      }

      if (response.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(jitteredBackoff(attempt, BASE_DELAY_MS))
        continue
      }

      throw new HarnessError(
        'amazon',
        httpStatusToCode(response.status),
        `Amazon API error ${response.status} ${response.statusText} for ${path}`,
      )
    }

    throw new HarnessError('amazon', 'max_retries', `Amazon API max retries exceeded for ${path}`)
  }

  async getProduct(productId: string): Promise<Product | null> {
    try {
      const data = await this.amazonFetch<AmazonCatalogSearchResponse>(
        '/catalog/2022-04-01/items',
        {
          query: {
            marketplaceIds: this.credentials.marketplaceId,
            identifiers: productId,
            identifiersType: 'ASIN',
            includedData: 'summaries',
          },
        },
      )
      const item = data.items?.[0]
      if (!item) return null
      return normalizeAmazonProduct(item, this.credentials.marketplaceId)
    } catch (err) {
      if (err instanceof HarnessError && err.code === '404') return null
      throw err
    }
  }

  async getProductsPage(opts?: PaginationOpts): Promise<PaginatedResult<Product>> {
    const data = await this.amazonFetch<AmazonCatalogSearchResponse>(
      '/catalog/2022-04-01/items',
      {
        query: {
          marketplaceIds: this.credentials.marketplaceId,
          sellerId: this.credentials.sellerId,
          pageSize: String(opts?.limit ?? 20),
          pageToken: opts?.cursor,
        },
      },
    )

    const items = (data.items ?? []).map((item) =>
      normalizeAmazonProduct(item, this.credentials.marketplaceId),
    )
    return { items, nextCursor: data.pagination?.nextToken }
  }

  async getProducts(opts?: PaginationOpts): Promise<Product[] & { truncated?: boolean }> {
    const page = await this.getProductsPage(opts)
    const items = page.items as Product[] & { truncated?: boolean }
    if (page.nextCursor !== undefined) items.truncated = true
    return items
  }

  private buildPricePatch(price: number): Array<{ op: 'replace'; path: string; value: unknown[] }> {
    const currency = MARKETPLACE_CURRENCY[this.credentials.marketplaceId] ?? 'USD'
    return [
      {
        op: 'replace',
        path: '/attributes/purchasable_offer',
        value: [
          {
            marketplace_id: this.credentials.marketplaceId,
            currency,
            our_price: [{ schedule: [{ value_with_tax: price.toFixed(2) }] }],
          },
        ],
      },
    ]
  }

  async updatePrice(productId: string, price: number): Promise<void> {
    await this.amazonFetch(
      `/listings/2021-08-01/items/${this.credentials.sellerId}/${productId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          productType: 'PRODUCT',
          patches: this.buildPricePatch(price),
        }),
        query: { marketplaceIds: this.credentials.marketplaceId },
      },
    )
  }

  private buildInventoryPatch(qty: number): Array<{ op: 'replace'; path: string; value: unknown[] }> {
    return [
      {
        op: 'replace',
        path: '/attributes/fulfillment_availability',
        value: [{ fulfillment_channel_code: 'DEFAULT', quantity: qty }],
      },
    ]
  }

  async updateInventory(productId: string, qty: number): Promise<void> {
    await this.amazonFetch(
      `/listings/2021-08-01/items/${this.credentials.sellerId}/${productId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          productType: 'PRODUCT',
          patches: this.buildInventoryPatch(qty),
        }),
        query: { marketplaceIds: this.credentials.marketplaceId },
      },
    )
  }

  async getOrdersPage(opts?: PaginationOpts & { createdAfter?: string; createdBefore?: string }): Promise<PaginatedResult<Order>> {
    const data = await this.amazonFetch<AmazonOrdersResponse>('/orders/v0/orders', {
      query: {
        MarketplaceIds: this.credentials.marketplaceId,
        CreatedAfter: opts?.createdAfter ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        CreatedBefore: opts?.createdBefore,
        MaxResultsPerPage: String(opts?.limit ?? 50),
        NextToken: opts?.cursor,
      },
    })
    const items = (data.payload?.Orders ?? []).map(normalizeAmazonOrder)
    return { items, nextCursor: data.payload?.NextToken }
  }

  async getOrders(opts?: PaginationOpts): Promise<Order[]> {
    const page = await this.getOrdersPage(opts)
    return page.items
  }

  async replyToMessage(threadId: string, body: string): Promise<void> {
    await this.amazonFetch(
      `/messaging/v1/orders/${threadId}/messages/confirmCustomizationDetails`,
      {
        method: 'POST',
        body: JSON.stringify({ text: body }),
      },
    )
  }

  async getOpenThreads(): Promise<Thread[]> {
    throw new HarnessError(
      'amazon',
      'not_implemented',
      'Amazon SP-API has no unified open-threads list endpoint — requires Messaging/SNS aggregation',
    )
  }

  async getAnalytics(range: DateRange): Promise<Analytics> {
    const PAGE_LIMIT = 100
    const page = await this.getOrdersPage({
      limit: PAGE_LIMIT,
      createdAfter: range.from.toISOString(),
      createdBefore: range.to.toISOString(),
    })
    const revenue = page.items.reduce((sum, order) => sum + order.totalPrice, 0)
    return {
      revenue,
      orders: page.items.length,
      truncated: page.items.length >= PAGE_LIMIT,
    }
  }
}

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
import type { HarnessInventoryLevel, InventoryCapableHarness } from './inventory.types.js'
import type {
  WalmartCredentials,
  WalmartTokenResponse,
  WalmartItemSummary,
  WalmartItemsResponse,
  WalmartOrderSummary,
  WalmartOrdersResponse,
  WalmartInventoryResponse,
} from './walmart.types.js'
import { TokenBucket, getSharedBucket, jitteredBackoff, sleep } from './token-bucket.js'

const WALMART_API_BASE_URL: Record<WalmartCredentials['region'], string> = {
  us: 'https://marketplace.walmartapis.com',
  ca: 'https://marketplace.walmartapis.ca',
  mx: 'https://marketplace.walmartapis.com.mx',
}

const WALMART_SANDBOX_BASE_URL: Record<WalmartCredentials['region'], string> = {
  us: 'https://sandbox.walmartapis.com',
  ca: 'https://sandbox.walmartapis.ca',
  mx: 'https://sandbox.walmartapis.com.mx',
}

const WALMART_TOKEN_URL: Record<WalmartCredentials['region'], string> = {
  us: 'https://marketplace.walmartapis.com/v3/token',
  ca: 'https://marketplace.walmartapis.ca/v3/token',
  mx: 'https://marketplace.walmartapis.com.mx/v3/token',
}

const ACCESS_TOKEN_SKEW_MS = 60_000
const MAX_RETRIES = 5
const BASE_DELAY_MS = 500
const FETCH_TIMEOUT_MS = 15_000

const WALMART_API_FAMILIES: Record<string, { capacity: number; refillRate: number }> = {
  '/v3/items':      { capacity: 5, refillRate: 5 },
  '/v3/orders':     { capacity: 5, refillRate: 5 },
  '/v3/inventory':  { capacity: 5, refillRate: 5 },
  '/v3/prices':     { capacity: 5, refillRate: 5 },
  '/v3/feeds':      { capacity: 2, refillRate: 2 },
}
const WALMART_DEFAULT_BUCKET_CONFIG = { capacity: 5, refillRate: 5 }

const REGION_CURRENCY: Record<WalmartCredentials['region'], string> = {
  us: 'USD',
  ca: 'CAD',
  mx: 'MXN',
}

interface WalmartRequestInit extends RequestInit {
  query?: Record<string, string | undefined>
}

function normalizeWalmartProduct(
  item: WalmartItemSummary,
  region: WalmartCredentials['region'],
): Product {
  return {
    id: item.sku,
    title: item.productName ?? item.sku,
    price: item.price?.amount ?? null,
    inventory: null,
    sku: item.sku,
    currency: item.price?.currency ?? REGION_CURRENCY[region],
    platformMeta: { platform: 'walmart', wpid: item.wpid, upc: item.upc },
  }
}

function normalizeWalmartOrder(order: WalmartOrderSummary): Order {
  const totalPrice = order.orderLines.orderLine.reduce((sum, line) => {
    const charges = line.charges?.charge ?? []
    return sum + charges.reduce((s, c) => s + (c.chargeAmount?.amount ?? 0), 0)
  }, 0)
  const statuses = order.orderLines.orderLine.flatMap(
    (l) => l.orderLineStatuses?.orderLineStatus?.map((s) => s.status) ?? [],
  )
  const status = statuses[0] ?? 'Unknown'
  return {
    id: order.purchaseOrderId,
    status,
    totalPrice,
  }
}

export class WalmartHarness implements TenantHarness, InventoryCapableHarness {
  readonly platformId = 'walmart'
  private readonly baseUrl: string

  private accessToken?: string
  private tokenExpiresAt = 0
  private refreshPromise: Promise<void> | null = null

  constructor(
    readonly tenantId: string,
    private readonly credentials: WalmartCredentials,
  ) {
    const sandbox = credentials.useSandbox !== false
    this.baseUrl = sandbox
      ? WALMART_SANDBOX_BASE_URL[credentials.region]
      : WALMART_API_BASE_URL[credentials.region]
  }

  // ─── Token management (Client Credentials grant) ───────────────────────────

  private getApiBucket(path: string): TokenBucket {
    const family =
      Object.keys(WALMART_API_FAMILIES).find((prefix) => path.startsWith(prefix)) ?? '/default/'
    const config = WALMART_API_FAMILIES[family] ?? WALMART_DEFAULT_BUCKET_CONFIG
    const bucketKey = `walmart:${this.credentials.clientId}:${family}`
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
    const tokenUrl = WALMART_TOKEN_URL[this.credentials.region]
    const basicAuth = Buffer.from(
      `${this.credentials.clientId}:${this.credentials.clientSecret}`,
    ).toString('base64')

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'WM_SVC.NAME': 'Walmart Marketplace',
        'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    })

    if (!response.ok) {
      throw new HarnessError(
        'walmart',
        'auth_failed',
        `Walmart token refresh failed: ${response.status} ${response.statusText}`,
      )
    }

    const token = (await response.json()) as WalmartTokenResponse
    if (!token.access_token || !token.expires_in) {
      throw new HarnessError('walmart', 'auth_failed', 'Walmart token payload is invalid')
    }

    this.accessToken = token.access_token
    this.tokenExpiresAt = Date.now() + Math.max(token.expires_in * 1000 - ACCESS_TOKEN_SKEW_MS, 1_000)
  }

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshAccessToken().finally(() => {
        this.refreshPromise = null
      })
    }
    await this.refreshPromise

    if (!this.accessToken) {
      throw new HarnessError('walmart', 'auth_failed', 'Walmart token refresh returned empty token')
    }
    return this.accessToken
  }

  // ─── Resilient HTTP fetch ──────────────────────────────────────────────────

  private async walmartFetch<T>(path: string, init?: WalmartRequestInit): Promise<T> {
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
            Accept: 'application/json',
            'WM_SEC.ACCESS_TOKEN': token,
            'WM_SVC.NAME': 'Walmart Marketplace',
            'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
            ...(init?.headers as Record<string, string> | undefined),
          },
        })
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          await sleep(jitteredBackoff(attempt, BASE_DELAY_MS))
          continue
        }
        throw new HarnessError(
          'walmart',
          'network_error',
          `Walmart network error for ${path}: ${error instanceof Error ? error.message : String(error)}`,
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
          throw new HarnessError('walmart', 'json_parse_error', `Walmart returned non-JSON response for ${path}`)
        }
        return data
      }

      if (response.status === 429 && attempt < MAX_RETRIES) {
        await sleep(jitteredBackoff(attempt, BASE_DELAY_MS))
        continue
      }

      if (response.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(jitteredBackoff(attempt, BASE_DELAY_MS))
        continue
      }

      throw new HarnessError(
        'walmart',
        httpStatusToCode(response.status),
        `Walmart API error ${response.status} ${response.statusText} for ${path}`,
      )
    }

    throw new HarnessError('walmart', 'max_retries', `Walmart API max retries exceeded for ${path}`)
  }

  // ─── TenantHarness implementation ─────────────────────────────────────────

  async getProduct(productId: string): Promise<Product | null> {
    try {
      const item = await this.walmartFetch<WalmartItemSummary>(`/v3/items/${productId}`)
      return normalizeWalmartProduct(item, this.credentials.region)
    } catch (err) {
      if (err instanceof HarnessError && err.code === '404') return null
      throw err
    }
  }

  async getProductsPage(opts?: PaginationOpts): Promise<PaginatedResult<Product>> {
    const data = await this.walmartFetch<WalmartItemsResponse>('/v3/items', {
      query: {
        limit: String(opts?.limit ?? 20),
        nextCursor: opts?.cursor,
      },
    })
    const items = (data.ItemResponse ?? []).map((item) =>
      normalizeWalmartProduct(item, this.credentials.region),
    )
    return { items, nextCursor: data.nextCursor }
  }

  async getProducts(opts?: PaginationOpts): Promise<Product[] & { truncated?: boolean }> {
    const page = await this.getProductsPage(opts)
    const items = page.items as Product[] & { truncated?: boolean }
    if (page.nextCursor !== undefined) items.truncated = true
    return items
  }

  async updatePrice(productId: string, price: number): Promise<void> {
    const currency = REGION_CURRENCY[this.credentials.region]
    await this.walmartFetch('/v3/prices', {
      method: 'PUT',
      body: JSON.stringify({
        sku: productId,
        pricing: [
          {
            currentPriceType: 'BASE',
            currentPrice: { currency, amount: price },
          },
        ],
      }),
    })
  }

  async updateInventory(productId: string, qty: number): Promise<void> {
    await this.walmartFetch('/v3/inventory', {
      method: 'PUT',
      query: { sku: productId },
      body: JSON.stringify({
        sku: productId,
        quantity: { unit: 'EACH', amount: qty },
      }),
    })
  }

  async getOrdersPage(
    opts?: PaginationOpts & { createdStartDate?: string; createdEndDate?: string },
  ): Promise<PaginatedResult<Order>> {
    const data = await this.walmartFetch<WalmartOrdersResponse>('/v3/orders', {
      query: {
        limit: String(opts?.limit ?? 50),
        nextCursor: opts?.cursor,
        createdStartDate: opts?.createdStartDate,
        createdEndDate: opts?.createdEndDate,
      },
    })
    const orders = (data.list?.elements?.order ?? []).map(normalizeWalmartOrder)
    return { items: orders, nextCursor: data.list?.meta?.nextCursor }
  }

  async getOrders(opts?: PaginationOpts): Promise<Order[]> {
    const page = await this.getOrdersPage(opts)
    return page.items
  }

  async replyToMessage(_threadId: string, _body: string): Promise<void> {
    throw new HarnessError(
      'walmart',
      'not_implemented',
      'Walmart Marketplace has no unified messaging API — use Seller Center for buyer communication',
    )
  }

  async getOpenThreads(): Promise<Thread[]> {
    throw new HarnessError(
      'walmart',
      'not_implemented',
      'Walmart Marketplace has no unified messaging API',
    )
  }

  async getAnalytics(range: DateRange): Promise<Analytics> {
    const PAGE_LIMIT = 100
    const page = await this.getOrdersPage({
      limit: PAGE_LIMIT,
      createdStartDate: range.from.toISOString(),
      createdEndDate: range.to.toISOString(),
    })
    const revenue = page.items.reduce((sum, order) => sum + order.totalPrice, 0)
    return {
      revenue,
      orders: page.items.length,
      truncated: page.items.length >= PAGE_LIMIT,
    }
  }

  // ─── InventoryCapableHarness ──────────────────────────────────────────────

  async getInventoryLevels(productIds?: string[]): Promise<HarnessInventoryLevel[]> {
    if (productIds && productIds.length > 0) {
      const results: HarnessInventoryLevel[] = []
      for (const sku of productIds) {
        try {
          const data = await this.walmartFetch<WalmartInventoryResponse>('/v3/inventory', {
            query: { sku },
          })
          for (const item of data.inventoryItems ?? []) {
            results.push({
              platformProductId: item.sku,
              quantity: item.quantity.amount,
              sku: item.sku,
            })
          }
        } catch (err) {
          if (err instanceof HarnessError && err.code === '404') continue
          throw err
        }
      }
      return results
    }

    const data = await this.walmartFetch<WalmartInventoryResponse>('/v3/inventory')
    return (data.inventoryItems ?? []).map((item) => ({
      platformProductId: item.sku,
      quantity: item.quantity.amount,
      sku: item.sku,
    }))
  }
}

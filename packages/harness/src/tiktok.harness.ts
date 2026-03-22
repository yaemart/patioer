import crypto from 'node:crypto'
import type { TenantHarness } from './base.harness.js'
import { HarnessError, httpStatusToCode } from './harness-error.js'
import { jitteredBackoff, sleep } from './token-bucket.js'
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
  TikTokApiResponse,
  TikTokCredentials,
  TikTokOrder,
  TikTokOrderListData,
  TikTokProduct,
  TikTokProductListData,
} from './tiktok.types.js'

const TIKTOK_BASE_URL = 'https://open-api.tiktokshop.com'
const MAX_RETRIES = 3
const BASE_DELAY_MS = 500
const FETCH_TIMEOUT_MS = 15_000

// ── Signing ──────────────────────────────────────────────────────────────────

/**
 * TikTok Shop API signing algorithm (HMAC-SHA256).
 *
 * Steps:
 *  1. Collect all params except `sign` and `access_token`, sort by key.
 *  2. Concatenate: appSecret + path + key1value1key2value2... + body (if any) + appSecret
 *  3. HMAC-SHA256 of the resulting string using appSecret as key.
 */
export function buildTikTokSign(
  appSecret: string,
  path: string,
  params: Record<string, string>,
  body?: string,
): string {
  const excludeKeys = new Set(['sign', 'access_token'])
  const paramStr = Object.keys(params)
    .filter((k) => !excludeKeys.has(k))
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('')
  const rawStr = `${appSecret}${path}${paramStr}${body ?? ''}${appSecret}`
  return crypto.createHmac('sha256', appSecret).update(rawStr).digest('hex')
}

/**
 * Builds the full set of signed query parameters for a TikTok API call.
 * The caller may pass any extra params (e.g. page_token, page_size).
 */
export function buildTikTokParams(
  appKey: string,
  appSecret: string,
  path: string,
  extra: Record<string, string> = {},
  body?: string,
): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const baseParams: Record<string, string> = { app_key: appKey, timestamp, ...extra }
  const sign = buildTikTokSign(appSecret, path, baseParams, body)
  return { ...baseParams, sign }
}

// ── Normalizers ──────────────────────────────────────────────────────────────

export function normalizeTikTokOrder(o: TikTokOrder): Order {
  return {
    id: o.order_id,
    status: o.status,
    totalPrice: Number(o.payment_info.total_amount),
  }
}

/**
 * Maps a TikTok product payload to the domain `Product` model.
 * If SKUs are present, the first SKU's price and inventory take precedence
 * over the product-level fields (TikTok SKU data is more granular).
 */
export function normalizeTikTokProduct(p: TikTokProduct): Product {
  const primarySku = p.skus?.[0]
  const rawPrice = primarySku?.price.amount ?? p.price.amount
  const rawInventory = primarySku?.inventory ?? p.inventory
  return {
    id: p.id,
    title: p.title,
    price: rawPrice !== undefined ? Number(rawPrice) : null,
    inventory: rawInventory ?? null,
    currency: p.price.currency,
    platformMeta: { platform: 'tiktok', status: p.status },
  }
}

// ── Harness ───────────────────────────────────────────────────────────────────

export class TikTokHarness implements TenantHarness {
  readonly platformId = 'tiktok'

  constructor(
    readonly tenantId: string,
    private readonly credentials: TikTokCredentials,
  ) {}

  // ── Internal request layer ────────────────────────────────────────────────

  private async tikTokFetch<T>(
    path: string,
    opts: {
      method?: 'GET' | 'POST' | 'PUT'
      query?: Record<string, string>
      body?: unknown
    } = {},
  ): Promise<T> {
    const method = opts.method ?? 'GET'
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined

    const extraParams: Record<string, string> = {
      access_token: this.credentials.accessToken,
      ...(this.credentials.shopId ? { shop_id: this.credentials.shopId } : {}),
      ...(opts.query ?? {}),
    }
    const signedParams = buildTikTokParams(
      this.credentials.appKey,
      this.credentials.appSecret,
      path,
      extraParams,
      bodyStr,
    )

    const url = new URL(path, TIKTOK_BASE_URL)
    for (const [k, v] of Object.entries(signedParams)) {
      url.searchParams.set(k, v)
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url.toString(), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })

      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(jitteredBackoff(attempt, BASE_DELAY_MS))
          continue
        }
        throw new HarnessError('tiktok', httpStatusToCode(res.status), `TikTok API error ${res.status}`)
      }

      const json = (await res.json()) as TikTokApiResponse<T>
      if (json.code !== 0) {
        throw new HarnessError('tiktok', 'network_error', `TikTok error ${json.code}: ${json.message}`)
      }
      return json.data as T
    }

    throw new HarnessError('tiktok', 'max_retries', 'TikTok API max retries exceeded')
  }

  // ── Products ──────────────────────────────────────────────────────────────

  async getProduct(productId: string): Promise<Product | null> {
    // TikTok: GET /api/products/{id} returns a single product detail
    interface TikTokProductDetailData { product: TikTokProduct }
    try {
      const data = await this.tikTokFetch<TikTokProductDetailData>(`/api/products/${productId}`)
      return normalizeTikTokProduct(data.product)
    } catch (err) {
      if (err instanceof HarnessError && err.code === '404') return null
      throw err
    }
  }

  async getProductsPage(opts?: PaginationOpts): Promise<PaginatedResult<Product>> {
    const body: Record<string, unknown> = {
      page_size: opts?.limit ?? 20,
    }
    if (opts?.cursor) body.page_token = opts.cursor

    const data = await this.tikTokFetch<TikTokProductListData>('/api/products/search', {
      method: 'POST',
      body,
    })

    const items = (data.products ?? []).map(normalizeTikTokProduct)
    return { items, nextCursor: data.next_page_token }
  }

  async getProducts(opts?: PaginationOpts): Promise<Product[]> {
    const page = await this.getProductsPage(opts)
    return page.items
  }

  // ── Price & Inventory ─────────────────────────────────────────────────────

  async updatePrice(productId: string, price: number): Promise<void> {
    // TikTok updates price at the SKU level via the product edit endpoint
    await this.tikTokFetch(`/api/products/${productId}`, {
      method: 'PUT',
      body: {
        skus: [
          {
            price: {
              amount: price.toFixed(2),
              currency: 'USD',
            },
          },
        ],
      },
    })
  }

  async updateInventory(productId: string, qty: number): Promise<void> {
    await this.tikTokFetch('/api/inventory/update', {
      method: 'POST',
      body: {
        inventory_list: [
          {
            sku_id: productId,
            warehouse_list: [{ available_stock: qty }],
          },
        ],
      },
    })
  }

  // ── Orders ───────────────────────────────────────────────────────────────

  async getOrdersPage(opts?: PaginationOpts): Promise<PaginatedResult<Order>> {
    const now = Math.floor(Date.now() / 1000)
    const body: Record<string, unknown> = {
      page_size: opts?.limit ?? 50,
      // Query last 30 days by default
      create_time_ge: now - 30 * 24 * 60 * 60,
      create_time_lt: now,
    }
    if (opts?.cursor) body.page_token = opts.cursor

    const data = await this.tikTokFetch<TikTokOrderListData>('/api/orders/search', {
      method: 'POST',
      body,
    })

    const items = (data.order_list ?? []).map(normalizeTikTokOrder)
    return { items, nextCursor: data.next_page_token }
  }

  async getOrders(opts?: PaginationOpts): Promise<Order[]> {
    const page = await this.getOrdersPage(opts)
    return page.items
  }

  // ── Messaging ─────────────────────────────────────────────────────────────

  async replyToMessage(threadId: string, body: string): Promise<void> {
    // TikTok Shop buyer-seller messaging via customer service API
    await this.tikTokFetch('/api/customer_service/message/send', {
      method: 'POST',
      body: {
        conversation_id: threadId,
        message_type: 'TEXT',
        content: { text: body },
      },
    })
  }

  async getOpenThreads(): Promise<Thread[]> {
    // MVP: Sprint 3 will wire /api/customer_service/conversations
    return []
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  async getAnalytics(_range: DateRange): Promise<Analytics> {
    // MVP: aggregate from recent orders; full Reports API deferred to Phase 3.
    // getOrders becomes available in Day11 — until then this returns zeroed data.
    try {
      const orders = await this.getOrders({ limit: 100 })
      const revenue = orders.reduce((sum, o) => sum + o.totalPrice, 0)
      return { revenue, orders: orders.length, truncated: orders.length >= 100 }
    } catch (err) {
      if (err instanceof HarnessError && err.code === 'not_implemented') {
        return { revenue: 0, orders: 0, truncated: true }
      }
      throw err
    }
  }
}

import crypto from 'node:crypto'
import type { TenantHarness } from './base.harness.js'
import { HarnessError, httpStatusToCode, type HarnessErrorCode } from './harness-error.js'
import { getSharedBucket, jitteredBackoff, sleep } from './token-bucket.js'
import type { TokenBucket } from './token-bucket.js'
import type { Analytics, DateRange, Order, PaginationOpts, PaginatedResult, Product, Thread } from './types.js'
import type {
  ShopeeApiResponse,
  ShopeeCredentials,
  ShopeeItem,
  ShopeeItemDetailResponse,
  ShopeeItemListResponse,
  ShopeeOrder,
  ShopeeOrderListResponse,
} from './shopee.types.js'
import { SHOPEE_MARKET_ENDPOINTS, SHOPEE_SANDBOX_ENDPOINT } from './shopee.types.js'

const MAX_RETRIES = 3
const BASE_DELAY_MS = 500

function classifyShopeeError(errorKey: string): HarnessErrorCode {
  if (errorKey.includes('auth') || errorKey.includes('permission')) return 'auth_failed'
  if (errorKey.includes('param') || errorKey.includes('invalid')) return 'invalid_param'
  if (errorKey.includes('not_found') || errorKey.includes('item.not_found')) return 'product_not_found'
  if (errorKey.includes('stock')) return 'insufficient_stock'
  return 'business_error'
}

// ── Signing ──────────────────────────────────────────────────────────────────

/**
 * Shopee Open Platform 签名算法：
 * sign = HMAC-SHA256(partnerKey, partnerId + path + timestamp + accessToken + shopId)
 */
export function buildShopeeSign(
  partnerKey: string,
  partnerId: number,
  path: string,
  timestamp: number,
  accessToken: string,
  shopId: number,
): string {
  const base = `${partnerId}${path}${timestamp}${accessToken}${shopId}`
  return crypto.createHmac('sha256', partnerKey).update(base).digest('hex')
}

/**
 * Assembles the full signed query-parameter map for a Shopee API call.
 * Any extra params (e.g. item_id_list, offset) are appended after signing.
 */
export function buildShopeeQuery(
  credentials: ShopeeCredentials,
  path: string,
  extra: Record<string, string | number> = {},
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000)
  const sign = buildShopeeSign(
    credentials.partnerKey,
    credentials.partnerId,
    path,
    timestamp,
    credentials.accessToken,
    credentials.shopId,
  )
  return {
    partner_id: String(credentials.partnerId),
    shop_id: String(credentials.shopId),
    timestamp: String(timestamp),
    access_token: credentials.accessToken,
    sign,
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])),
  }
}

// ── Normalizers ──────────────────────────────────────────────────────────────

/**
 * Maps Shopee item detail payload to the domain `Product` model.
 * Aligns with Phase 2 plan: defaults for missing price/stock use 0 / SGD.
 */
export function normalizeShopeeItem(item: ShopeeItem): Product {
  const price = item.price_info?.[0]?.current_price ?? 0
  const currency = item.price_info?.[0]?.currency ?? 'SGD'
  const inventory = item.stock_info_v2?.summary_info?.total_available_stock ?? 0
  return {
    id: String(item.item_id),
    title: item.item_name,
    price,
    inventory,
    currency,
    platformMeta: { platform: 'shopee' },
  }
}

export function normalizeShopeeOrder(o: ShopeeOrder): Order {
  return {
    id: o.order_sn,
    status: o.order_status,
    totalPrice: o.total_amount,
  }
}

// ── Harness ───────────────────────────────────────────────────────────────────

export class ShopeeHarness implements TenantHarness {
  readonly platformId = 'shopee'
  private readonly baseUrl: string
  private readonly bucket: TokenBucket

  constructor(
    readonly tenantId: string,
    private readonly credentials: ShopeeCredentials,
  ) {
    this.baseUrl = credentials.sandbox
      ? SHOPEE_SANDBOX_ENDPOINT
      : SHOPEE_MARKET_ENDPOINTS[credentials.market]
    const bucketKey = `shopee:${credentials.shopId}`
    this.bucket = getSharedBucket(bucketKey, { capacity: 10, refillRatePerSecond: 10 })
  }

  // ── Internal request layer ────────────────────────────────────────────────

  private async shopeeFetch<T>(
    path: string,
    opts: {
      method?: 'GET' | 'POST'
      extra?: Record<string, string | number>
      body?: unknown
    } = {},
  ): Promise<T> {
    const method = opts.method ?? 'GET'
    const query = buildShopeeQuery(this.credentials, path, opts.extra)
    const url = new URL(path, this.baseUrl)
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v)
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.bucket.acquire()
      const res = await fetch(url.toString(), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(15_000),
      })

      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(jitteredBackoff(attempt, BASE_DELAY_MS))
          continue
        }
        throw new HarnessError('shopee', httpStatusToCode(res.status), `Shopee API error ${res.status}`)
      }

      const json = (await res.json()) as ShopeeApiResponse<T>
      if (json.error && json.error !== '') {
        const code = classifyShopeeError(json.error)
        throw new HarnessError('shopee', code, `Shopee error ${json.error}: ${json.message}`)
      }
      return json.response as T
    }

    throw new HarnessError('shopee', 'max_retries', 'Shopee API max retries exceeded')
  }

  // ── Products ──────────────────────────────────────────────────────────────

  async getProduct(productId: string): Promise<Product | null> {
    const detailData = await this.shopeeFetch<ShopeeItemDetailResponse>(
      '/api/v2/product/get_item_base_info',
      { extra: { item_id_list: productId } },
    )
    const item = detailData.item_list?.[0]
    if (!item) return null
    return normalizeShopeeItem(item)
  }

  async getProductsPage(opts?: PaginationOpts): Promise<PaginatedResult<Product>> {
    const offset = opts?.cursor ? Number(opts.cursor) : 0
    const listData = await this.shopeeFetch<ShopeeItemListResponse>('/api/v2/product/get_item_list', {
      extra: {
        offset,
        page_size: opts?.limit ?? 20,
        item_status: 'NORMAL',
      },
    })

    const itemIds = (listData.item ?? []).map((i) => i.item_id)
    if (itemIds.length === 0) return { items: [] }

    const detailData = await this.shopeeFetch<ShopeeItemDetailResponse>(
      '/api/v2/product/get_item_base_info',
      { extra: { item_id_list: itemIds.join(',') } },
    )

    const items = (detailData.item_list ?? []).map(normalizeShopeeItem)
    const nextCursor = listData.has_next_page
      ? String(offset + itemIds.length)
      : undefined

    return { items, nextCursor }
  }

  async getProducts(opts?: PaginationOpts): Promise<Product[] & { truncated?: boolean }> {
    const page = await this.getProductsPage(opts)
    const items = page.items as Product[] & { truncated?: boolean }
    if (page.nextCursor !== undefined) items.truncated = true
    return items
  }

  async updatePrice(productId: string, price: number): Promise<void> {
    await this.shopeeFetch('/api/v2/product/update_price', {
      method: 'POST',
      body: {
        item_id: Number(productId),
        price_list: [
          {
            model_id: 0,
            original_price: price,
          },
        ],
      },
    })
  }

  async updateInventory(productId: string, qty: number): Promise<void> {
    await this.shopeeFetch('/api/v2/product/update_stock', {
      method: 'POST',
      body: {
        item_id: Number(productId),
        stock_list: [{ model_id: 0, normal_stock: qty }],
      },
    })
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  async getOrdersPage(opts?: PaginationOpts): Promise<PaginatedResult<Order>> {
    const now = Math.floor(Date.now() / 1000)
    const data = await this.shopeeFetch<ShopeeOrderListResponse>('/api/v2/order/get_order_list', {
      extra: {
        time_range_field: 'create_time',
        time_from: now - 30 * 24 * 60 * 60,
        time_to: now,
        page_size: opts?.limit ?? 50,
        ...(opts?.cursor ? { cursor: opts.cursor } : {}),
      },
    })
    const items = (data.order_list ?? []).map(normalizeShopeeOrder)
    return { items, nextCursor: data.next_cursor }
  }

  async getOrders(opts?: PaginationOpts): Promise<Order[]> {
    const page = await this.getOrdersPage(opts)
    return page.items
  }

  // ── Messaging ─────────────────────────────────────────────────────────────

  async replyToMessage(threadId: string, body: string): Promise<void> {
    await this.shopeeFetch('/api/v2/sellerchat/send_message', {
      method: 'POST',
      body: {
        toId: threadId,
        message_type: 'text',
        content: { text: body },
      },
    })
  }

  async getOpenThreads(): Promise<Thread[]> {
    throw new HarnessError(
      'shopee',
      'not_implemented',
      'Shopee seller chat conversation list API not wired — getOpenThreads not available',
    )
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  async getAnalytics(range: DateRange): Promise<Analytics> {
    const PAGE_LIMIT = 100
    const data = await this.shopeeFetch<ShopeeOrderListResponse>('/api/v2/order/get_order_list', {
      extra: {
        time_range_field: 'create_time',
        time_from: Math.floor(range.from.getTime() / 1000),
        time_to: Math.floor(range.to.getTime() / 1000),
        page_size: PAGE_LIMIT,
      },
    })
    const orders = (data.order_list ?? []).map(normalizeShopeeOrder)
    const revenue = orders.reduce((sum, o) => sum + o.totalPrice, 0)
    return { revenue, orders: orders.length, truncated: orders.length >= PAGE_LIMIT }
  }
}

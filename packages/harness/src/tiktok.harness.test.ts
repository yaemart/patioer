/**
 * Day 15 — TikTokHarness 完整测试套件（phase2-plan CARD-D15-01）
 *
 * 分组：signing · tikTokFetch · normalize/getProducts · updatePrice ·
 * updateInventory · getAnalytics · getOrders · messaging · regression
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TikTokHarness, buildTikTokSign, buildTikTokParams, normalizeTikTokProduct, normalizeTikTokOrder } from './tiktok.harness.js'
import { HarnessError } from './harness-error.js'
import type { TikTokCredentials, TikTokOrder, TikTokProduct } from './tiktok.types.js'
import { resetSharedBuckets } from './token-bucket.js'

// ── Global fetch mock ─────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCredentials(overrides: Partial<TikTokCredentials> = {}): TikTokCredentials {
  return {
    appKey: 'test-app-key',
    appSecret: 'test-app-secret-32bytes-padding!!',
    accessToken: 'test-access-token',
    shopId: 'test-shop-id',
    ...overrides,
  }
}

function makeHarness(overrides: Partial<TikTokCredentials> = {}): TikTokHarness {
  return new TikTokHarness('tenant-1', makeCredentials(overrides))
}

/** 与 phase2-plan Day15 可复制模板一致的 fixture */
const mockCredentials: TikTokCredentials = {
  appKey: 'test-app-key',
  appSecret: 'test-app-secret-32bytes-padding!!',
  accessToken: 'test-access-token',
  shopId: 'test-shop-id',
}

/** Returns a fetch mock that resolves with a TikTok API success envelope. */
function okResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ code: 0, message: 'success', data }),
  }
}

/** Returns a fetch mock that resolves with a TikTok API error envelope (HTTP 200, code ≠ 0). */
function tikTokErrorResponse(code: number, message: string) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ code, message, data: undefined }),
  }
}

/** Returns a fetch mock that resolves with a non-2xx HTTP response. */
function httpErrorResponse(status: number) {
  return {
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve({ code: status, message: 'error' }),
  }
}

afterEach(() => {
  mockFetch.mockReset()
  vi.useRealTimers()
  resetSharedBuckets()
})

// ── Signing (CARD-D9-02) ────────────────────────────────────────────────────

describe('TikTokHarness signing', () => {
describe('buildTikTokSign', () => {
  it('returns deterministic HMAC-SHA256 for given params', () => {
    const sign1 = buildTikTokSign('secret', '/api/products', { app_key: 'key', timestamp: '1000' })
    const sign2 = buildTikTokSign('secret', '/api/products', { app_key: 'key', timestamp: '1000' })
    expect(sign1).toBe(sign2)
    expect(sign1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('excludes sign and access_token from param string', () => {
    const withExtra = buildTikTokSign('secret', '/path', {
      app_key: 'k',
      timestamp: '1',
      sign: 'old-sign',
      access_token: 'tok',
    })
    const withoutExtra = buildTikTokSign('secret', '/path', {
      app_key: 'k',
      timestamp: '1',
    })
    expect(withExtra).toBe(withoutExtra)
  })

  it('sorts params by key before hashing', () => {
    const signAB = buildTikTokSign('secret', '/path', { b: '2', a: '1' })
    const signBA = buildTikTokSign('secret', '/path', { a: '1', b: '2' })
    expect(signAB).toBe(signBA)
  })

  it('includes body in the signature when provided', () => {
    const withBody = buildTikTokSign('secret', '/path', { app_key: 'k' }, '{"x":1}')
    const withoutBody = buildTikTokSign('secret', '/path', { app_key: 'k' })
    expect(withBody).not.toBe(withoutBody)
  })
})

// ── CARD-D9-02: buildTikTokParams ─────────────────────────────────────────────

describe('buildTikTokParams', () => {
  it('includes app_key and timestamp in result', () => {
    const params = buildTikTokParams('mykey', 'mysecret', '/api/test')
    expect(params.app_key).toBe('mykey')
    expect(params.timestamp).toMatch(/^\d+$/)
  })

  it('includes sign field in result', () => {
    const params = buildTikTokParams('mykey', 'mysecret', '/api/test')
    expect(params.sign).toMatch(/^[0-9a-f]{64}$/)
  })

  it('merges extra params into signed output', () => {
    const params = buildTikTokParams('mykey', 'mysecret', '/api/test', { page_size: '20' })
    expect(params.page_size).toBe('20')
  })
})
})

// ── tikTokFetch (CARD-D9-03) ─────────────────────────────────────────────────

describe('TikTokHarness tikTokFetch', () => {
  it('signs request with app_key and timestamp in URL query params', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ products: [] }))
    const harness = makeHarness()
    // Access private method through bracket notation for testing
    const internal = harness as unknown as {
      tikTokFetch: (path: string, opts?: object) => Promise<unknown>
    }
    await internal.tikTokFetch('/api/products/search', { method: 'POST', body: {} })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const calledUrl: string = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('app_key=test-app-key')
    expect(calledUrl).toContain('timestamp=')
    expect(calledUrl).toContain('sign=')
  })

  it('includes shop_id in query params when credential has shopId', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}))
    const harness = makeHarness({ shopId: 'my-shop-123' })
    const internal = harness as unknown as {
      tikTokFetch: (path: string, opts?: object) => Promise<unknown>
    }
    await internal.tikTokFetch('/api/orders/search', { method: 'POST', body: {} })

    const calledUrl: string = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).toContain('shop_id=my-shop-123')
  })

  it('omits shop_id from query params when credential has no shopId', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}))
    const harness = makeHarness({ shopId: undefined })
    const internal = harness as unknown as {
      tikTokFetch: (path: string, opts?: object) => Promise<unknown>
    }
    await internal.tikTokFetch('/api/products/search', { method: 'POST', body: {} })

    const calledUrl: string = mockFetch.mock.calls[0][0] as string
    expect(calledUrl).not.toContain('shop_id=')
  })

  it('throws HarnessError when TikTok code is non-zero', async () => {
    mockFetch.mockResolvedValueOnce(tikTokErrorResponse(40001, 'invalid app_key'))
    const harness = makeHarness()
    const internal = harness as unknown as {
      tikTokFetch: (path: string, opts?: object) => Promise<unknown>
    }
    await expect(internal.tikTokFetch('/api/products/search', { method: 'POST', body: {} }))
      .rejects.toMatchObject({ type: 'harness_error', platform: 'tiktok' })
  })

  it('retries on 429 with exponential backoff and succeeds on later attempt', async () => {
    vi.useFakeTimers()
    mockFetch
      .mockResolvedValueOnce(httpErrorResponse(429))
      .mockResolvedValueOnce(okResponse({ products: [] }))
    const harness = makeHarness()
    const internal = harness as unknown as {
      tikTokFetch: (path: string, opts?: object) => Promise<unknown>
    }

    const promise = internal.tikTokFetch('/api/products/search', { method: 'POST', body: {} })
    // Attach then-handler before advancing timers to avoid unhandled-rejection warning
    const settled = promise.then(() => 'ok').catch(() => 'err')
    await vi.runAllTimersAsync()
    expect(await settled).toBe('ok')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('throws HarnessError after all retries exhausted on 500', async () => {
    vi.useFakeTimers()
    // Make all attempts return 500
    mockFetch.mockResolvedValue(httpErrorResponse(500))
    const harness = makeHarness()
    const internal = harness as unknown as {
      tikTokFetch: (path: string, opts?: object) => Promise<unknown>
    }

    const promise = internal.tikTokFetch('/api/products/search', { method: 'POST', body: {} })
    // Attach rejection handler BEFORE advancing timers to prevent unhandled-rejection warning.
    // On the final attempt (attempt === MAX_RETRIES), `attempt < MAX_RETRIES` is false,
    // so the 500 error is re-thrown with its HTTP status code rather than 'max_retries'.
    const assertion = expect(promise).rejects.toMatchObject({
      type: 'harness_error',
      platform: 'tiktok',
      code: '500',
    })
    await vi.runAllTimersAsync()
    await assertion
    // MAX_RETRIES = 3, so 4 total attempts (0..3)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })
})

// ── CARD-D9-03: TikTokHarness skeleton stubs ─────────────────────────────────

describe('TikTokHarness skeleton stubs', () => {
  it('platformId is "tiktok"', () => {
    const harness = makeHarness()
    expect(harness.platformId).toBe('tiktok')
  })

  it('tenantId is stored correctly', () => {
    const harness = new TikTokHarness('my-tenant', makeCredentials())
    expect(harness.tenantId).toBe('my-tenant')
  })

  it('getOpenThreads throws not_implemented', async () => {
    const harness = makeHarness()
    await expect(harness.getOpenThreads()).rejects.toMatchObject({
      type: 'harness_error',
      code: 'not_implemented',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ── CARD-D10-01: normalizeTikTokProduct ──────────────────────────────────────

describe('normalizeTikTokProduct', () => {
  const baseProduct: TikTokProduct = {
    id: 'prod-1',
    title: 'Test Widget',
    status: 'active',
    price: { amount: '19.99', currency: 'USD' },
    inventory: 50,
  }

  it('maps TikTok product fields to Product domain model', () => {
    const result = normalizeTikTokProduct(baseProduct)
    expect(result).toMatchObject({
      id: 'prod-1',
      title: 'Test Widget',
      price: 19.99,
      inventory: 50,
      currency: 'USD',
    })
  })

  it('uses primary SKU price and inventory when skus are present', () => {
    const withSkus: TikTokProduct = {
      ...baseProduct,
      skus: [{ id: 'sku-1', price: { amount: '29.99' }, inventory: 10 }],
    }
    const result = normalizeTikTokProduct(withSkus)
    expect(result.price).toBe(29.99)
    expect(result.inventory).toBe(10)
  })

  it('falls back to product-level price when no skus', () => {
    const result = normalizeTikTokProduct({ ...baseProduct, skus: undefined })
    expect(result.price).toBe(19.99)
    expect(result.inventory).toBe(50)
  })

  it('includes platform in platformMeta', () => {
    const result = normalizeTikTokProduct(baseProduct)
    expect(result.platformMeta).toMatchObject({ platform: 'tiktok' })
  })
})

// ── CARD-D10-01: getProductsPage / getProducts ────────────────────────────────

describe('TikTokHarness getProducts', () => {
  it('maps TikTok products to Product domain model', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({
      products: [
        { id: 'p1', title: 'Widget A', status: 'active', price: { amount: '9.99', currency: 'USD' }, inventory: 5 },
        { id: 'p2', title: 'Widget B', status: 'active', price: { amount: '14.50', currency: 'USD' }, inventory: 20 },
      ],
      next_page_token: undefined,
    }))

    const harness = makeHarness()
    const result = await harness.getProducts()

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 'p1', title: 'Widget A', price: 9.99, currency: 'USD' })
    expect(result[1]).toMatchObject({ id: 'p2', price: 14.50 })
  })

  it('returns empty array when TikTok returns no products', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ products: [], next_page_token: undefined }))

    const harness = makeHarness()
    const result = await harness.getProducts()

    expect(result).toEqual([])
  })

  it('getProductsPage returns nextCursor from next_page_token', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({
      products: [
        { id: 'p1', title: 'W', status: 'active', price: { amount: '1.00', currency: 'USD' }, inventory: 1 },
      ],
      next_page_token: 'cursor-abc',
    }))

    const harness = makeHarness()
    const page = await harness.getProductsPage({ limit: 1 })

    expect(page.nextCursor).toBe('cursor-abc')
    expect(page.items).toHaveLength(1)
  })

  it('getProductsPage returns undefined nextCursor when no more pages', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ products: [], next_page_token: undefined }))

    const harness = makeHarness()
    const page = await harness.getProductsPage()

    expect(page.nextCursor).toBeUndefined()
  })

  it('normalizes price from primary SKU when skus array is present', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({
      products: [{
        id: 'p1', title: 'SKU Widget', status: 'active',
        price: { amount: '100.00', currency: 'USD' }, inventory: 0,
        skus: [{ id: 'sku-1', price: { amount: '29.99' }, inventory: 7 }],
      }],
      next_page_token: undefined,
    }))

    const harness = makeHarness()
    const result = await harness.getProducts()

    expect(result[0].price).toBe(29.99)
    expect(result[0].inventory).toBe(7)
  })

  it('passes cursor as page_token in request body', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ products: [], next_page_token: undefined }))

    const harness = makeHarness()
    await harness.getProductsPage({ cursor: 'page-token-xyz', limit: 10 })

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>
    expect(callBody.page_token).toBe('page-token-xyz')
    expect(callBody.page_size).toBe(10)
  })
})

// ── CARD-D10-02: updatePrice ──────────────────────────────────────────────────

describe('TikTokHarness updatePrice', () => {
  const productResponse = (currency = 'USD') =>
    okResponse({
      product: {
        id: 'prod-123',
        title: 'Test',
        status: 'active',
        price: { amount: '10.00', currency },
        inventory: 5,
      },
    })

  it('sends PUT request to product endpoint with price payload', async () => {
    mockFetch
      .mockResolvedValueOnce(productResponse())
      .mockResolvedValueOnce(okResponse({}))

    const harness = makeHarness()
    await harness.updatePrice('prod-123', 24.99)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const [calledUrl, calledInit] = mockFetch.mock.calls[1] as [string, RequestInit]
    expect(calledUrl).toContain('/api/products/prod-123')
    expect(calledInit.method).toBe('PUT')
  })

  it('formats price to two decimal places and uses product currency', async () => {
    mockFetch
      .mockResolvedValueOnce(productResponse('GBP'))
      .mockResolvedValueOnce(okResponse({}))

    const harness = makeHarness()
    await harness.updatePrice('prod-123', 9.9)

    const body = JSON.parse(mockFetch.mock.calls[1][1].body as string) as {
      skus: Array<{ price: { amount: string; currency: string } }>
    }
    expect(body.skus[0].price.amount).toBe('9.90')
    expect(body.skus[0].price.currency).toBe('GBP')
  })

  it('throws HarnessError when TikTok API returns error code', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: () => Promise.resolve({ code: 400, message: 'invalid product' }),
    })

    const harness = makeHarness()
    await expect(harness.updatePrice('bad-id', 10)).rejects.toMatchObject({
      type: 'harness_error',
      platform: 'tiktok',
    })
  })
})

// ── CARD-D10-03: updateInventory ──────────────────────────────────────────────

describe('TikTokHarness updateInventory', () => {
  it('sends POST request to inventory/update with inventory_list payload', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}))

    const harness = makeHarness()
    await harness.updateInventory('sku-abc', 100)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toContain('/api/inventory/update')
    expect(calledInit.method).toBe('POST')
  })

  it('wraps productId as sku_id in inventory_list', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}))

    const harness = makeHarness()
    await harness.updateInventory('my-sku-id', 42)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      inventory_list: Array<{ sku_id: string; warehouse_list: Array<{ available_stock: number }> }>
    }
    expect(body.inventory_list[0].sku_id).toBe('my-sku-id')
    expect(body.inventory_list[0].warehouse_list[0].available_stock).toBe(42)
  })

  it('throws HarnessError when API responds with error code', async () => {
    // 500 is retryable — use persistent mock so all MAX_RETRIES attempts return 500
    vi.useFakeTimers()
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ code: 500, message: 'internal error' }),
    })

    const harness = makeHarness()
    const assertion = expect(harness.updateInventory('sku-1', 10)).rejects.toMatchObject({
      type: 'harness_error',
      platform: 'tiktok',
    })
    await vi.runAllTimersAsync()
    await assertion
  })
})

// ── CARD-D10-04: getAnalytics ─────────────────────────────────────────────────

describe('TikTokHarness getAnalytics', () => {
  const makeOrder = (id: string, amount: string) => ({
    order_id: id,
    status: 'delivered',
    payment_info: { total_amount: amount, currency: 'USD' },
    create_time: 1700000000,
    line_items: [],
  })

  it('aggregates revenue and order count within date range', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        order_list: [makeOrder('o1', '30'), makeOrder('o2', '70')],
        next_page_token: undefined,
      }),
    )

    const result = await makeHarness().getAnalytics({ from: new Date('2024-01-01'), to: new Date('2024-01-31') })

    expect(result.revenue).toBe(100)
    expect(result.orders).toBe(2)
    expect(result.truncated).toBe(false)
  })

  it('returns zero revenue and orders when no orders in range', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ order_list: [] }))

    const result = await makeHarness().getAnalytics({ from: new Date(), to: new Date() })

    expect(result.revenue).toBe(0)
    expect(result.orders).toBe(0)
  })

  it('sets truncated=true when order count reaches the 100 limit', async () => {
    const orders = Array.from({ length: 100 }, (_, i) => makeOrder(`o${i}`, '10'))
    mockFetch.mockResolvedValueOnce(okResponse({ order_list: orders }))

    const result = await makeHarness().getAnalytics({ from: new Date(), to: new Date() })

    expect(result.truncated).toBe(true)
    expect(result.orders).toBe(100)
  })

  it('passes date range as unix timestamps to TikTok API', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ order_list: [] }))
    const from = new Date('2024-06-01T00:00:00Z')
    const to = new Date('2024-06-30T23:59:59Z')

    await makeHarness().getAnalytics({ from, to })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body.create_time_ge).toBe(Math.floor(from.getTime() / 1000))
    expect(body.create_time_lt).toBe(Math.floor(to.getTime() / 1000))
  })
})

// ── CARD-D11-01: normalizeTikTokOrder ────────────────────────────────────────

describe('normalizeTikTokOrder', () => {
  const raw: TikTokOrder = {
    order_id: 'ord-1',
    status: 'AWAITING_SHIPMENT',
    payment_info: { total_amount: '99.50', currency: 'USD' },
    create_time: 1700000000,
    line_items: [{ product_id: 'p1', quantity: 2 }],
  }

  it('maps order_id to id', () => {
    expect(normalizeTikTokOrder(raw).id).toBe('ord-1')
  })

  it('maps status verbatim', () => {
    expect(normalizeTikTokOrder(raw).status).toBe('AWAITING_SHIPMENT')
  })

  it('converts total_amount string to number', () => {
    expect(normalizeTikTokOrder(raw).totalPrice).toBe(99.5)
  })
})

// ── CARD-D11-01: getOrdersPage / getOrders ───────────────────────────────────

describe('TikTokHarness getOrdersPage', () => {
  it('returns normalized orders and nextCursor from API', async () => {
    const rawOrder: TikTokOrder = {
      order_id: 'ord-42',
      status: 'COMPLETED',
      payment_info: { total_amount: '150.00', currency: 'USD' },
      create_time: 1700000000,
      line_items: [],
    }
    mockFetch.mockResolvedValueOnce(
      okResponse({ order_list: [rawOrder], next_page_token: 'tok-next' }),
    )

    const harness = makeHarness()
    const page = await harness.getOrdersPage({ limit: 10 })

    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ id: 'ord-42', status: 'COMPLETED', totalPrice: 150 })
    expect(page.nextCursor).toBe('tok-next')
  })

  it('passes page_token when cursor provided', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ order_list: [], next_page_token: undefined }))

    const harness = makeHarness()
    await harness.getOrdersPage({ cursor: 'cursor-abc' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>
    expect(body.page_token).toBe('cursor-abc')
  })

  it('returns empty items when order_list is absent', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}))
    const harness = makeHarness()
    const page = await harness.getOrdersPage()
    expect(page.items).toEqual([])
  })

  it('throws HarnessError on API error code', async () => {
    mockFetch.mockResolvedValueOnce(tikTokErrorResponse(40001, 'unauthorized'))
    const harness = makeHarness()
    await expect(harness.getOrdersPage()).rejects.toMatchObject({
      type: 'harness_error',
      platform: 'tiktok',
    })
  })
})

describe('TikTokHarness getOrders', () => {
  it('returns flattened items from getOrdersPage', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        order_list: [
          { order_id: 'o1', status: 'COMPLETED', payment_info: { total_amount: '10.00', currency: 'USD' }, create_time: 0, line_items: [] },
        ],
      }),
    )
    const harness = makeHarness()
    const orders = await harness.getOrders({ limit: 50 })
    expect(orders).toHaveLength(1)
    expect(orders[0].id).toBe('o1')
  })
})

// ── CARD-D11-02: replyToMessage ───────────────────────────────────────────────

describe('TikTokHarness replyToMessage', () => {
  it('POSTs to customer_service message endpoint with correct body', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}))

    const harness = makeHarness()
    await harness.replyToMessage('thread-99', 'Hello there!')

    const call = mockFetch.mock.calls[0]
    expect((call[0] as string)).toContain('/api/customer_service/message/send')
    expect(call[1].method).toBe('POST')

    const body = JSON.parse(call[1].body as string) as Record<string, unknown>
    expect(body.conversation_id).toBe('thread-99')
    expect(body.message_type).toBe('TEXT')
    expect((body.content as { text: string }).text).toBe('Hello there!')
  })

  it('throws HarnessError when API returns non-zero code', async () => {
    mockFetch.mockResolvedValueOnce(tikTokErrorResponse(40301, 'conversation not found'))
    const harness = makeHarness()
    await expect(harness.replyToMessage('bad-thread', 'hi')).rejects.toMatchObject({
      type: 'harness_error',
      platform: 'tiktok',
    })
  })

  it('retries on 429 and succeeds', async () => {
    vi.useFakeTimers()
    mockFetch
      .mockResolvedValueOnce(httpErrorResponse(429))
      .mockResolvedValueOnce(okResponse({}))

    const harness = makeHarness()
    const promise = harness.replyToMessage('t1', 'hi')
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBeUndefined()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('getOpenThreads throws not_implemented', async () => {
    const harness = makeHarness()
    await expect(harness.getOpenThreads()).rejects.toMatchObject({
      type: 'harness_error',
      code: 'not_implemented',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ── Regression (CARD-D15-01) ────────────────────────────────────────────────

describe('TikTokHarness regression', () => {
  it('all core methods work independently after full implementation', async () => {
    expect(mockCredentials.appKey).toBe('test-app-key')

    mockFetch
      .mockResolvedValueOnce(okResponse({ products: [], next_page_token: undefined }))
      .mockResolvedValueOnce(okResponse({ order_list: [], next_page_token: undefined }))

    const harness = new TikTokHarness('tenant-regression', mockCredentials)

    await expect(harness.getProducts({ limit: 5 })).resolves.toEqual([])
    await expect(harness.getOrders({ limit: 5 })).resolves.toEqual([])
    await expect(harness.getOpenThreads()).rejects.toMatchObject({
      type: 'harness_error',
      code: 'not_implemented',
    })

    mockFetch.mockResolvedValueOnce(okResponse({
      order_list: [{ order_id: 'o1', status: 'paid', payment_info: { total_amount: '42', currency: 'USD' }, create_time: 1700000000, line_items: [] }],
    }))
    await expect(harness.getAnalytics({ from: new Date(), to: new Date() })).resolves.toMatchObject({
      revenue: 42,
      orders: 1,
      truncated: false,
    })
  })
})

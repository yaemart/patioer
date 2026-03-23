/**
 * Day 15 — ShopeeHarness 完整测试套件（phase2-plan CARD-D15-02）
 *
 * 分组：signing · query · normalizers · constructor · shopeeFetch ·
 * getProducts · updatePrice · getOrders · inventory/messaging/analytics ·
 * endpoints · getProduct · regression
 */
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetSharedBuckets } from './token-bucket.js'
import {
  buildShopeeSign,
  buildShopeeQuery,
  normalizeShopeeItem,
  normalizeShopeeOrder,
  ShopeeHarness,
} from './shopee.harness.js'
import { SHOPEE_MARKET_ENDPOINTS, SHOPEE_SANDBOX_ENDPOINT } from './shopee.types.js'
import type { ShopeeCredentials, ShopeeItem, ShopeeOrder } from './shopee.types.js'

// ── Global fetch mock ─────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCredentials(overrides: Partial<ShopeeCredentials> = {}): ShopeeCredentials {
  return {
    partnerId: 100001,
    partnerKey: 'test-partner-key-32bytes-padding!!',
    accessToken: 'test-access-token',
    shopId: 999888,
    market: 'SG',
    ...overrides,
  }
}

function makeHarness(overrides: Partial<ShopeeCredentials> = {}): ShopeeHarness {
  return new ShopeeHarness('tenant-1', makeCredentials(overrides))
}

/** 与 phase2-plan Day15 模板一致的 fixture */
const mockShopeeCredentials: ShopeeCredentials = {
  partnerId: 100001,
  partnerKey: 'test-partner-key-32bytes-padding!!',
  accessToken: 'test-access-token',
  shopId: 999888,
  market: 'SG',
}

/** Returns a fetch mock that resolves with a Shopee API success envelope. */
function okResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ error: '', message: 'success', response: data }),
  }
}

/** Returns a fetch mock that resolves with a Shopee API error envelope (HTTP 200, error ≠ ''). */
function shopeeErrorResponse(errorCode: string, message = 'api error') {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ error: errorCode, message, response: undefined }),
  }
}

/** Returns a fetch mock that resolves with a non-2xx HTTP response. */
function httpErrorResponse(status: number) {
  return {
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve({ error: String(status), message: 'error' }),
  }
}

afterEach(() => {
  mockFetch.mockReset()
  vi.useRealTimers()
  resetSharedBuckets()
})

// ── CARD-D12-02: buildShopeeSign ─────────────────────────────────────────────

describe('buildShopeeSign', () => {
  it('produces deterministic HMAC-SHA256 for given inputs', () => {
    const sign1 = buildShopeeSign('key', 100001, '/api/v2/product/get_item_list', 1700000000, 'tok', 999888)
    const sign2 = buildShopeeSign('key', 100001, '/api/v2/product/get_item_list', 1700000000, 'tok', 999888)
    expect(sign1).toBe(sign2)
    expect(sign1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('concatenates fields in correct order (partnerId + path + timestamp + accessToken + shopId)', () => {
    // Manually compute expected HMAC to verify field ordering
    const partnerKey = 'secret-key'
    const partnerId = 111
    const path = '/api/v2/test'
    const timestamp = 1700000001
    const accessToken = 'mytoken'
    const shopId = 222

    const base = `${partnerId}${path}${timestamp}${accessToken}${shopId}`
    const expected = createHmac('sha256', partnerKey).update(base).digest('hex')

    expect(buildShopeeSign(partnerKey, partnerId, path, timestamp, accessToken, shopId)).toBe(expected)
  })

  it('different timestamps produce different signatures', () => {
    const a = buildShopeeSign('key', 1, '/path', 1000, 'tok', 1)
    const b = buildShopeeSign('key', 1, '/path', 1001, 'tok', 1)
    expect(a).not.toBe(b)
  })

  it('different shopIds produce different signatures', () => {
    const a = buildShopeeSign('key', 1, '/path', 1000, 'tok', 100)
    const b = buildShopeeSign('key', 1, '/path', 1000, 'tok', 200)
    expect(a).not.toBe(b)
  })
})

// ── CARD-D12-02: buildShopeeQuery ─────────────────────────────────────────────

describe('buildShopeeQuery', () => {
  it('includes partner_id, shop_id, timestamp, sign in output', () => {
    const creds = makeCredentials()
    const query = buildShopeeQuery(creds, '/api/v2/product/get_item_list')
    expect(query).toHaveProperty('partner_id', String(creds.partnerId))
    expect(query).toHaveProperty('shop_id', String(creds.shopId))
    expect(query).toHaveProperty('timestamp')
    expect(query).toHaveProperty('sign')
    expect(query.sign).toMatch(/^[0-9a-f]{64}$/)
  })

  it('includes access_token in output', () => {
    const creds = makeCredentials()
    const query = buildShopeeQuery(creds, '/api/v2/product/get_item_list')
    expect(query).toHaveProperty('access_token', creds.accessToken)
  })

  it('accepts extra query parameters and converts them to strings', () => {
    const creds = makeCredentials()
    const query = buildShopeeQuery(creds, '/api/v2/product/get_item_list', {
      offset: 20,
      page_size: 50,
      item_status: 'NORMAL',
    })
    expect(query.offset).toBe('20')
    expect(query.page_size).toBe('50')
    expect(query.item_status).toBe('NORMAL')
  })

  it('all values in returned map are strings', () => {
    const query = buildShopeeQuery(makeCredentials(), '/test', { foo: 123 })
    for (const [, v] of Object.entries(query)) {
      expect(typeof v).toBe('string')
    }
  })
})

// ── CARD-D12-01: normalizeShopeeItem ─────────────────────────────────────────

describe('normalizeShopeeItem', () => {
  const raw: ShopeeItem = {
    item_id: 12345,
    item_name: 'Test Product',
    price_info: [{ current_price: 29.99, currency: 'SGD' }],
    stock_info_v2: { summary_info: { total_available_stock: 50 } },
  }

  it('maps item_id to id as string', () => {
    expect(normalizeShopeeItem(raw).id).toBe('12345')
  })

  it('maps item_name to title', () => {
    expect(normalizeShopeeItem(raw).title).toBe('Test Product')
  })

  it('maps first price_info price to price', () => {
    expect(normalizeShopeeItem(raw).price).toBe(29.99)
  })

  it('maps stock from stock_info_v2 summary', () => {
    expect(normalizeShopeeItem(raw).inventory).toBe(50)
  })

  it('maps currency from price_info', () => {
    expect(normalizeShopeeItem(raw).currency).toBe('SGD')
  })

  it('defaults price to 0 and currency to SGD when price_info is empty', () => {
    const p = normalizeShopeeItem({ ...raw, price_info: [] })
    expect(p.price).toBe(0)
    expect(p.currency).toBe('SGD')
  })

  it('defaults inventory to 0 when stock_info_v2 is absent', () => {
    const noStock: ShopeeItem = { ...raw, stock_info_v2: undefined }
    expect(normalizeShopeeItem(noStock).inventory).toBe(0)
  })
})

// ── CARD-D12-01: normalizeShopeeOrder ────────────────────────────────────────

describe('normalizeShopeeOrder', () => {
  const raw: ShopeeOrder = {
    order_sn: 'ORD-ABC-123',
    order_status: 'READY_TO_SHIP',
    total_amount: 59.90,
    currency: 'SGD',
    create_time: 1700000000,
  }

  it('maps order_sn to id', () => {
    expect(normalizeShopeeOrder(raw).id).toBe('ORD-ABC-123')
  })

  it('maps order_status to status', () => {
    expect(normalizeShopeeOrder(raw).status).toBe('READY_TO_SHIP')
  })

  it('maps total_amount to totalPrice', () => {
    expect(normalizeShopeeOrder(raw).totalPrice).toBe(59.90)
  })
})

// ── CARD-D12-03: ShopeeHarness constructor ────────────────────────────────────

describe('ShopeeHarness constructor', () => {
  it('uses sandbox endpoint when sandbox=true', () => {
    const harness = makeHarness({ sandbox: true })
    // Access private baseUrl via cast for white-box verification
    const internal = harness as unknown as { baseUrl: string }
    expect(internal.baseUrl).toBe(SHOPEE_SANDBOX_ENDPOINT)
  })

  it('uses market endpoint from SHOPEE_MARKET_ENDPOINTS when not sandbox', () => {
    const harness = makeHarness({ market: 'MY', sandbox: false })
    const internal = harness as unknown as { baseUrl: string }
    expect(internal.baseUrl).toBe(SHOPEE_MARKET_ENDPOINTS['MY'])
  })

  it('defaults to live endpoint for each supported market', () => {
    const markets = ['SG', 'TH', 'PH', 'ID', 'VN'] as const
    for (const market of markets) {
      const h = makeHarness({ market })
      const internal = h as unknown as { baseUrl: string }
      expect(internal.baseUrl).toBe(SHOPEE_MARKET_ENDPOINTS[market])
    }
  })

  it('exposes platformId as "shopee"', () => {
    expect(makeHarness().platformId).toBe('shopee')
  })

  it('exposes tenantId', () => {
    expect(makeHarness().tenantId).toBe('tenant-1')
  })
})

// ── CARD-D12-03: shopeeFetch ─────────────────────────────────────────────────

describe('ShopeeHarness shopeeFetch', () => {
  it('appends signed query parameters to URL', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ items: [] }))

    const harness = makeHarness()
    const internal = harness as unknown as {
      shopeeFetch: (path: string, opts?: object) => Promise<unknown>
    }
    await internal.shopeeFetch('/api/v2/product/get_item_list')

    const calledUrl = new URL(mockFetch.mock.calls[0][0] as string)
    expect(calledUrl.searchParams.has('partner_id')).toBe(true)
    expect(calledUrl.searchParams.has('shop_id')).toBe(true)
    expect(calledUrl.searchParams.has('sign')).toBe(true)
    expect(calledUrl.searchParams.has('timestamp')).toBe(true)
    expect(calledUrl.searchParams.has('access_token')).toBe(true)
  })

  it('throws HarnessError when Shopee error field is non-empty', async () => {
    mockFetch.mockResolvedValueOnce(shopeeErrorResponse('error.product_not_found', 'item not found'))

    const harness = makeHarness()
    const internal = harness as unknown as {
      shopeeFetch: (path: string, opts?: object) => Promise<unknown>
    }
    await expect(internal.shopeeFetch('/api/v2/product/get_item_list')).rejects.toMatchObject({
      type: 'harness_error',
      platform: 'shopee',
      code: 'product_not_found',
    })
  })

  it('retries on 429 with exponential backoff and eventually succeeds', async () => {
    vi.useFakeTimers()
    mockFetch
      .mockResolvedValueOnce(httpErrorResponse(429))
      .mockResolvedValueOnce(okResponse({ items: [] }))

    const harness = makeHarness()
    const internal = harness as unknown as {
      shopeeFetch: (path: string, opts?: object) => Promise<unknown>
    }
    const promise = internal.shopeeFetch('/api/v2/product/get_item_list')
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBeDefined()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('throws HarnessError after all retries exhausted on 500', async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValue(httpErrorResponse(500))

    const harness = makeHarness()
    const internal = harness as unknown as {
      shopeeFetch: (path: string, opts?: object) => Promise<unknown>
    }
    const promise = internal.shopeeFetch('/api/v2/product/get_item_list')
    const assertion = expect(promise).rejects.toMatchObject({
      type: 'harness_error',
      platform: 'shopee',
      code: '500',
    })
    await vi.runAllTimersAsync()
    await assertion
    // MAX_RETRIES = 3 → 4 total attempts (attempt 0, 1, 2, 3)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('throws HarnessError immediately on non-retryable 400', async () => {
    mockFetch.mockResolvedValueOnce(httpErrorResponse(400))

    const harness = makeHarness()
    const internal = harness as unknown as {
      shopeeFetch: (path: string, opts?: object) => Promise<unknown>
    }
    await expect(internal.shopeeFetch('/api/v2/product/get_item_list')).rejects.toMatchObject({
      type: 'harness_error',
      platform: 'shopee',
      code: '400',
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('sends POST with JSON body when method is POST', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}))

    const harness = makeHarness()
    const internal = harness as unknown as {
      shopeeFetch: (path: string, opts?: object) => Promise<unknown>
    }
    await internal.shopeeFetch('/api/v2/product/update_price', {
      method: 'POST',
      body: { item_id: 123, price: 19.99 },
    })

    const callArgs = mockFetch.mock.calls[0][1] as RequestInit
    expect(callArgs.method).toBe('POST')
    expect(JSON.parse(callArgs.body as string)).toMatchObject({ item_id: 123, price: 19.99 })
  })
})

// ── CARD-D13-01: getProducts / getProductsPage ───────────────────────────────

describe('ShopeeHarness getProducts', () => {
  it('maps Shopee item list to Product domain model', async () => {
    mockFetch
      .mockResolvedValueOnce(
        okResponse({
          item: [{ item_id: 1001, item_status: 'NORMAL' }],
          has_next_page: false,
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          item_list: [
            {
              item_id: 1001,
              item_name: 'Widget',
              price_info: [{ current_price: 12.5, currency: 'SGD' }],
              stock_info_v2: { summary_info: { total_available_stock: 7 } },
            },
          ],
        }),
      )

    const products = await makeHarness().getProducts({ limit: 20 })
    expect(products).toHaveLength(1)
    expect(products[0]).toMatchObject({
      id: '1001',
      title: 'Widget',
      price: 12.5,
      inventory: 7,
      currency: 'SGD',
    })
  })

  it('returns empty array when item list is empty', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ item: [] }))
    const products = await makeHarness().getProducts()
    expect(products).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('uses price_info and stock_info_v2 for normalization', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse({ item: [{ item_id: 2002, item_status: 'NORMAL' }] }))
      .mockResolvedValueOnce(
        okResponse({
          item_list: [
            {
              item_id: 2002,
              item_name: 'SKU A',
              price_info: [{ current_price: 99, currency: 'MYR' }],
              stock_info_v2: { summary_info: { total_available_stock: 3 } },
            },
          ],
        }),
      )
    const [p] = await makeHarness({ market: 'MY' }).getProducts()
    expect(p.price).toBe(99)
    expect(p.currency).toBe('MYR')
    expect(p.inventory).toBe(3)
  })
})

describe('ShopeeHarness getProductsPage', () => {
  it('returns nextCursor when has_next_page is true', async () => {
    mockFetch
      .mockResolvedValueOnce(
        okResponse({
          item: [{ item_id: 1, item_status: 'NORMAL' }],
          has_next_page: true,
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          item_list: [
            {
              item_id: 1,
              item_name: 'A',
              price_info: [{ current_price: 1, currency: 'SGD' }],
            },
          ],
        }),
      )

    const page = await makeHarness().getProductsPage({ limit: 10 })
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBe('1')
  })

  it('returns undefined nextCursor when no more pages', async () => {
    mockFetch
      .mockResolvedValueOnce(
        okResponse({
          item: [{ item_id: 1, item_status: 'NORMAL' }],
          has_next_page: false,
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          item_list: [
            { item_id: 1, item_name: 'A', price_info: [{ current_price: 1, currency: 'SGD' }] },
          ],
        }),
      )

    const page = await makeHarness().getProductsPage()
    expect(page.nextCursor).toBeUndefined()
  })
})

// ── CARD-D13-02: updatePrice ─────────────────────────────────────────────────

describe('ShopeeHarness updatePrice', () => {
  it('sends POST with item_id and original_price', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}))
    await makeHarness().updatePrice('42', 19.99)

    const call = mockFetch.mock.calls[0]
    expect((call[0] as string)).toContain('/api/v2/product/update_price')
    const init = call[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toMatchObject({
      item_id: 42,
      price_list: [{ model_id: 0, original_price: 19.99 }],
    })
  })

  it('converts productId string to number', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}))
    await makeHarness().updatePrice('999', 5)
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string) as {
      item_id: number
    }
    expect(body.item_id).toBe(999)
  })

  it('throws HarnessError when Shopee returns error', async () => {
    mockFetch.mockResolvedValueOnce(shopeeErrorResponse('error.invalid_item', 'bad item'))
    await expect(makeHarness().updatePrice('1', 10)).rejects.toMatchObject({
      type: 'harness_error',
      platform: 'shopee',
      code: 'invalid_param',
    })
  })
})

// ── CARD-D13-03: getOrders / getOrdersPage ───────────────────────────────────

describe('ShopeeHarness getOrders', () => {
  it('maps Shopee order list to Order domain model', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        order_list: [
          {
            order_sn: 'SN-1',
            order_status: 'COMPLETED',
            total_amount: 100.5,
            currency: 'SGD',
            create_time: 1700000000,
          },
        ],
      }),
    )
    const orders = await makeHarness().getOrders({ limit: 50 })
    expect(orders[0]).toMatchObject({ id: 'SN-1', status: 'COMPLETED', totalPrice: 100.5 })
  })

  it('returns empty array when order_list missing', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}))
    const orders = await makeHarness().getOrders()
    expect(orders).toEqual([])
  })
})

describe('ShopeeHarness getOrdersPage', () => {
  it('returns nextCursor from next_cursor field', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        order_list: [],
        next_cursor: 'cursor-next-abc',
      }),
    )
    const page = await makeHarness().getOrdersPage({ cursor: 'cursor-start' })
    expect(page.nextCursor).toBe('cursor-next-abc')
    const url = new URL(mockFetch.mock.calls[0][0] as string)
    expect(url.searchParams.get('cursor')).toBe('cursor-start')
  })
})

// ── CARD-D13-04: updateInventory / replyToMessage / getAnalytics ────────────

describe('ShopeeHarness updateInventory', () => {
  it('sends POST with item_id and normal_stock', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}))
    await makeHarness().updateInventory('77', 42)

    const init = mockFetch.mock.calls[0][1] as RequestInit
    expect((mockFetch.mock.calls[0][0] as string)).toContain('/api/v2/product/update_stock')
    expect(JSON.parse(init.body as string)).toMatchObject({
      item_id: 77,
      stock_list: [{ model_id: 0, normal_stock: 42 }],
    })
  })
})

describe('ShopeeHarness replyToMessage', () => {
  it('sends POST to sellerchat endpoint with text', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({}))
    await makeHarness().replyToMessage('buyer-thread-1', 'Hello buyer')

    const init = mockFetch.mock.calls[0][1] as RequestInit
    expect((mockFetch.mock.calls[0][0] as string)).toContain('/api/v2/sellerchat/send_message')
    expect(JSON.parse(init.body as string)).toMatchObject({
      toId: 'buyer-thread-1',
      message_type: 'text',
      content: { text: 'Hello buyer' },
    })
  })
})

describe('ShopeeHarness getAnalytics', () => {
  it('aggregates revenue and sets truncated correctly', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        order_list: [
          { order_sn: 'a', order_status: 'x', total_amount: 10, currency: 'SGD', create_time: 0 },
          { order_sn: 'b', order_status: 'x', total_amount: 20.5, currency: 'SGD', create_time: 0 },
        ],
      }),
    )
    const result = await makeHarness().getAnalytics({ from: new Date(), to: new Date() })
    expect(result.revenue).toBe(30.5)
    expect(result.orders).toBe(2)
    expect(result.truncated).toBe(false)
  })

  it('sets truncated true when 100 orders returned', async () => {
    const order_list = Array.from({ length: 100 }, (_, i) => ({
      order_sn: `sn-${i}`,
      order_status: 'x',
      total_amount: 1,
      currency: 'SGD',
      create_time: 0,
    }))
    mockFetch.mockResolvedValueOnce(okResponse({ order_list }))
    const result = await makeHarness().getAnalytics({ from: new Date(), to: new Date() })
    expect(result.orders).toBe(100)
    expect(result.truncated).toBe(true)
  })
})

// ── CARD-D13-05: multi-market endpoint smoke ─────────────────────────────────

describe('ShopeeHarness multi-market endpoints (Day13)', () => {
  it('ShopeeHarness SG market uses correct endpoint', () => {
    const h = makeHarness({ market: 'SG', sandbox: false })
    expect((h as unknown as { baseUrl: string }).baseUrl).toBe(SHOPEE_MARKET_ENDPOINTS.SG)
  })

  it('ShopeeHarness MY market uses correct endpoint', () => {
    const h = makeHarness({ market: 'MY', sandbox: false })
    expect((h as unknown as { baseUrl: string }).baseUrl).toBe(SHOPEE_MARKET_ENDPOINTS.MY)
  })

  it('ShopeeHarness sandbox=true uses test-stable endpoint', () => {
    const h = makeHarness({ sandbox: true })
    expect((h as unknown as { baseUrl: string }).baseUrl).toBe(SHOPEE_SANDBOX_ENDPOINT)
  })
})

// ── getOpenThreads (unchanged MVP) ───────────────────────────────────────────

describe('ShopeeHarness getOpenThreads', () => {
  it('throws not_implemented', async () => {
    await expect(makeHarness().getOpenThreads()).rejects.toMatchObject({
      type: 'harness_error',
      code: 'not_implemented',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ── getProduct ───────────────────────────────────────────────────────────────

describe('ShopeeHarness getProduct', () => {
  it('returns null when item_list is empty', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ item_list: [] }))
    expect(await makeHarness().getProduct('999')).toBeNull()
  })

  it('returns normalized Product when found', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        item_list: [
          {
            item_id: 999,
            item_name: 'One',
            price_info: [{ current_price: 5, currency: 'SGD' }],
          },
        ],
      }),
    )
    const p = await makeHarness().getProduct('999')
    expect(p).toMatchObject({ id: '999', title: 'One', price: 5 })
  })
})

// ── Regression (CARD-D15-02) ────────────────────────────────────────────────

describe('ShopeeHarness regression', () => {
  it('core read paths compose for products and analytics', async () => {
    expect(mockShopeeCredentials.partnerId).toBe(100001)

    mockFetch.mockResolvedValueOnce(okResponse({ item: [] }))

    const harness = new ShopeeHarness('tenant-regression', mockShopeeCredentials)
    await expect(harness.getProducts()).resolves.toEqual([])

    mockFetch.mockResolvedValueOnce(okResponse({
      order_list: [{ order_sn: 'sn1', order_status: 'COMPLETED', total_amount: 25.5 }],
    }))
    await expect(harness.getAnalytics({ from: new Date(), to: new Date() })).resolves.toMatchObject({
      revenue: 25.5,
      orders: 1,
      truncated: false,
    })
  })
})

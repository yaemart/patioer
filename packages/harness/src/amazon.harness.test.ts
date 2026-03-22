import { afterEach, describe, expect, it, vi } from 'vitest'
import { AmazonHarness } from './amazon.harness.js'
import type { AmazonCredentials } from './amazon.types.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function makeCredentials(overrides: Partial<AmazonCredentials> = {}): AmazonCredentials {
  return {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    sellerId: 'seller-id',
    marketplaceId: 'ATVPDKIKX0DER',
    region: 'na',
    ...overrides,
  }
}

function makeHarness(credentials: Partial<AmazonCredentials> = {}): AmazonHarness {
  return new AmazonHarness('tenant-1', makeCredentials(credentials))
}

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  }
}

afterEach(() => {
  mockFetch.mockReset()
  vi.useRealTimers()
})

describe('AmazonHarness token refresh', () => {
  it('refreshes token once and reuses cached access token', async () => {
    mockFetch.mockResolvedValue(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
    const harness = makeHarness()
    const ensure = harness as unknown as { ensureAccessToken: () => Promise<string> }

    const first = await ensure.ensureAccessToken()
    const second = await ensure.ensureAccessToken()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(first).toBe('token-1')
    expect(second).toBe('token-1')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.amazon.com/auth/o2/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      }),
    )
  })

  it('refreshes token again when cache is expired', async () => {
    mockFetch.mockResolvedValue(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
    const harness = makeHarness()
    const ensure = harness as unknown as { ensureAccessToken: () => Promise<string> }

    await ensure.ensureAccessToken()
    const mutableHarness = harness as unknown as { tokenExpiresAt: number }
    mutableHarness.tokenExpiresAt = Date.now() - 1_000
    mockFetch.mockResolvedValueOnce(
      ok({ access_token: 'token-2', token_type: 'bearer', expires_in: 3600 }),
    )

    const refreshed = await ensure.ensureAccessToken()

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(refreshed).toBe('token-2')
  })

  it('throws HarnessError when LWA token endpoint returns non-2xx', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({}),
    })
    const harness = makeHarness()
    const ensure = harness as unknown as { ensureAccessToken: () => Promise<string> }

    await expect(ensure.ensureAccessToken()).rejects.toMatchObject({
      type: 'harness_error',
      platform: 'amazon',
      code: 'auth_failed',
    })
  })
})

describe('AmazonHarness amazonFetch behavior', () => {
  it('amazonFetch appends query parameters and sends x-amz-access-token header', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce(ok({ items: [] }))

    const harness = makeHarness()
    await harness.getProductsPage({ limit: 10, cursor: 'next-1' })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const apiCall = mockFetch.mock.calls[1]
    const url: string = apiCall[0]
    const init = apiCall[1] as RequestInit

    expect(url).toContain('/catalog/2022-04-01/items')
    expect(url).toContain('marketplaceIds=ATVPDKIKX0DER')
    expect(url).toContain('sellerId=seller-id')
    expect(url).toContain('pageSize=10')
    expect(url).toContain('pageToken=next-1')
    expect(init.headers).toMatchObject({
      'x-amz-access-token': 'token-1',
      'Content-Type': 'application/json',
    })
  })

  it('amazonFetch retries on 429 and succeeds on later attempt', async () => {
    vi.useFakeTimers()
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce(ok({ items: [] }))

    const task = makeHarness().getProductsPage()
    await vi.runAllTimersAsync()
    const page = await task

    expect(page.items).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('amazonFetch throws HarnessError after max retries', async () => {
    vi.useFakeTimers()
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      })

    const task = makeHarness().getProductsPage()
    const assertion = expect(task).rejects.toMatchObject({
      type: 'harness_error',
      platform: 'amazon',
      code: '500',
    })
    await vi.runAllTimersAsync()
    await assertion
    // 1 token fetch + MAX_RETRIES(5)+1 = 7 total calls
    expect(mockFetch).toHaveBeenCalledTimes(7)
  })
})

describe('AmazonHarness core methods', () => {
  it('getProductsPage maps catalog items into Product domain model', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce(
        ok({
          items: [{ asin: 'B001', title: 'Cable', sku: 'SKU-1' }],
          pagination: { nextToken: 'p-2' },
        }),
      )

    const page = await makeHarness().getProductsPage({ limit: 1 })

    expect(page.nextCursor).toBe('p-2')
    expect(page.items).toEqual([
      {
        id: 'B001',
        title: 'Cable',
        price: null,
        inventory: null,
        sku: 'SKU-1',
        currency: undefined,
        platformMeta: { platform: 'amazon', asin: 'B001', source: 'catalog-items' },
      },
    ])
  })

  it('getProductsPage returns empty items when Amazon response has no items', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce(ok({}))

    const page = await makeHarness().getProductsPage()
    expect(page).toEqual({ items: [], nextCursor: undefined })
  })

  it('getProducts returns page items from getProductsPage', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce(ok({ items: [{ asin: 'B002', title: 'Mouse' }] }))

    const items = await makeHarness().getProducts()
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('B002')
  })

  it('updatePrice sends PATCH request with purchasable_offer payload', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce(ok({}))

    await makeHarness().updatePrice('B003', 12.5)

    const patchCall = mockFetch.mock.calls[1]
    expect(patchCall[0]).toContain('/listings/2021-08-01/items/seller-id/B003')
    expect(patchCall[1]).toMatchObject({ method: 'PATCH' })

    const parsed = JSON.parse((patchCall[1] as RequestInit).body as string)
    expect(parsed.patches[0].path).toBe('/attributes/purchasable_offer')
    expect(parsed.patches[0].value[0].our_price[0].schedule[0].value_with_tax).toBe('12.50')
  })

  it('updatePrice throws HarnessError when listings API fails', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      })

    await expect(makeHarness().updatePrice('missing', 10)).rejects.toMatchObject({
      type: 'harness_error',
      platform: 'amazon',
      code: '404',
    })
  })

  it('getOrdersPage maps Amazon Orders payload to Order domain model', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce(
        ok({
          payload: {
            Orders: [{ AmazonOrderId: 'O-1', OrderStatus: 'Shipped', OrderTotal: { Amount: '19.99' } }],
            NextToken: 'cursor-2',
          },
        }),
      )

    const page = await makeHarness().getOrdersPage({ limit: 5 })
    expect(page.nextCursor).toBe('cursor-2')
    expect(page.items).toEqual([{ id: 'O-1', status: 'Shipped', totalPrice: 19.99 }])
  })

  it('getOrders returns items from getOrdersPage', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce(ok({ payload: { Orders: [{ AmazonOrderId: 'O-2', OrderStatus: 'Pending' }] } }))

    const orders = await makeHarness().getOrders()
    expect(orders).toEqual([{ id: 'O-2', status: 'Pending', totalPrice: 0 }])
  })

  it('getOrdersPage returns empty array when payload Orders missing', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce(ok({ payload: {} }))

    const page = await makeHarness().getOrdersPage()
    expect(page).toEqual({ items: [], nextCursor: undefined })
  })

  it('updateInventory sends PATCH request with fulfillment_availability payload', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce(ok({}))

    await makeHarness().updateInventory('B004', 23)

    const patchCall = mockFetch.mock.calls[1]
    expect(patchCall[0]).toContain('/listings/2021-08-01/items/seller-id/B004')
    expect(patchCall[1]).toMatchObject({ method: 'PATCH' })

    const parsed = JSON.parse((patchCall[1] as RequestInit).body as string)
    expect(parsed.patches[0].path).toBe('/attributes/fulfillment_availability')
    expect(parsed.patches[0].value[0]).toEqual({
      fulfillment_channel_code: 'DEFAULT',
      quantity: 23,
    })
  })

  it('updateInventory throws HarnessError when listings API fails', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      })

    await expect(makeHarness().updateInventory('B004', 0)).rejects.toMatchObject({
      type: 'harness_error',
      platform: 'amazon',
      code: '400',
    })
  })
})

describe('AmazonHarness getAnalytics', () => {
  it('getAnalytics passes DateRange to orders query', async () => {
    const from = new Date('2024-06-01T00:00:00Z')
    const to = new Date('2024-06-30T23:59:59Z')

    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce(
        ok({
          payload: {
            Orders: [
              { AmazonOrderId: 'O-1', OrderStatus: 'Shipped', OrderTotal: { Amount: '10.00' } },
              { AmazonOrderId: 'O-2', OrderStatus: 'Shipped', OrderTotal: { Amount: '25.50' } },
            ],
          },
        }),
      )

    const analytics = await makeHarness().getAnalytics({ from, to })

    expect(analytics.revenue).toBeCloseTo(35.5)
    expect(analytics.orders).toBe(2)
    expect(analytics.truncated).toBe(false)

    const ordersCallUrl: string = mockFetch.mock.calls[1][0]
    expect(ordersCallUrl).toContain(`CreatedAfter=${encodeURIComponent(from.toISOString())}`)
    expect(ordersCallUrl).toContain(`CreatedBefore=${encodeURIComponent(to.toISOString())}`)
  })

  it('getAnalytics returns zero when getOrders returns empty list', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce(ok({ payload: { Orders: [] } }))

    const analytics = await makeHarness().getAnalytics({ from: new Date(), to: new Date() })

    expect(analytics).toEqual({ revenue: 0, orders: 0, truncated: false })
  })

  it('getAnalytics sets truncated=true when order count reaches limit', async () => {
    const orders = Array.from({ length: 100 }, (_, i) => ({
      AmazonOrderId: `O-${i}`,
      OrderStatus: 'Shipped',
      OrderTotal: { Amount: '1.00' },
    }))

    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce(ok({ payload: { Orders: orders } }))

    const analytics = await makeHarness().getAnalytics({ from: new Date(), to: new Date() })

    expect(analytics.truncated).toBe(true)
    expect(analytics.orders).toBe(100)
    expect(analytics.revenue).toBeCloseTo(100)
  })
})

describe('AmazonHarness messaging', () => {
  it('replyToMessage sends POST request to messaging endpoint with text payload', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce({ ok: true, status: 204, statusText: 'No Content', headers: { get: () => null }, json: () => Promise.resolve(null) })

    await makeHarness().replyToMessage('order-123', 'Your item is on the way!')

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const postCall = mockFetch.mock.calls[1]
    expect(postCall[0]).toContain('/messaging/v1/orders/order-123/messages/confirmCustomizationDetails')
    expect(postCall[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse((postCall[1] as RequestInit).body as string)).toEqual({
      text: 'Your item is on the way!',
    })
  })

  it('replyToMessage throws HarnessError when messaging API responds non-2xx', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      })

    await expect(makeHarness().replyToMessage('order-err', 'hello')).rejects.toMatchObject({
      type: 'harness_error',
      platform: 'amazon',
      code: '403',
    })
  })

  it('getOpenThreads returns empty array in MVP mode', async () => {
    const threads = await makeHarness().getOpenThreads()

    expect(threads).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('AmazonHarness regression', () => {
  it('core methods keep working after Day5 additions', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce(ok({ items: [{ asin: 'B010', title: 'Hub' }] }))

    const products = await makeHarness().getProducts()
    expect(products).toHaveLength(1)
    expect(products[0]?.id).toBe('B010')
  })

  it('token refresh flow still works with analytics and messaging calls', async () => {
    const harness = makeHarness()

    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-reg', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce(ok({ payload: { Orders: [{ AmazonOrderId: 'O-R', OrderStatus: 'Shipped', OrderTotal: { Amount: '5.00' } }] } }))
      .mockResolvedValueOnce({ ok: true, status: 204, statusText: 'No Content', headers: { get: () => null }, json: () => Promise.resolve(null) })

    const analytics = await harness.getAnalytics({ from: new Date(), to: new Date() })
    expect(analytics.orders).toBe(1)

    await harness.replyToMessage('O-R', 'shipped!')
    expect(mockFetch).toHaveBeenCalledTimes(3)

    const thirdCall = mockFetch.mock.calls[2]
    expect((thirdCall[1] as RequestInit).headers).toMatchObject({
      'x-amz-access-token': 'token-reg',
    })
  })
})

describe('AmazonHarness rate limiting', () => {
  it('getApiBucket returns different buckets for catalog and orders paths', () => {
    const harness = makeHarness()
    const getBucket = (harness as unknown as { getApiBucket: (p: string) => object }).getApiBucket.bind(harness)

    const catalogBucket = getBucket('/catalog/2022-04-01/items')
    const ordersBucket = getBucket('/orders/v0/orders')

    expect(catalogBucket).not.toBe(ordersBucket)
  })

  it('getApiBucket reuses same bucket for same path family', () => {
    const harness = makeHarness()
    const getBucket = (harness as unknown as { getApiBucket: (p: string) => object }).getApiBucket.bind(harness)

    const first = getBucket('/catalog/2022-04-01/items')
    const second = getBucket('/catalog/2022-04-01/items')

    expect(first).toBe(second)
  })

  it('amazonFetch uses x-amzn-RateLimit-Limit header delay on 429', async () => {
    vi.useFakeTimers()
    const sleepSpy = vi.spyOn(globalThis, 'setTimeout')

    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: { get: (name: string) => (name === 'x-amzn-RateLimit-Limit' ? '0.5' : null) },
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce(ok({ items: [] }))

    const task = makeHarness().getProductsPage()
    await vi.runAllTimersAsync()
    await task

    // header: 0.5 req/s → min 2000ms delay; backoff: 500*2^0=500ms → max(2000,500)=2000ms
    const delayCall = sleepSpy.mock.calls.find(
      (args) => typeof args[1] === 'number' && (args[1] as number) >= 2000,
    )
    expect(delayCall).toBeDefined()
    sleepSpy.mockRestore()
  })

  it('amazonFetch retries up to 5 times on 5xx before throwing', async () => {
    vi.useFakeTimers()
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'token-1', token_type: 'bearer', expires_in: 3600 }))
      .mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      })

    const task = makeHarness().getProductsPage()
    const assertion = expect(task).rejects.toMatchObject({
      type: 'harness_error',
      platform: 'amazon',
      code: '503',
    })
    await vi.runAllTimersAsync()
    await assertion

    // 1 token + 6 api calls (attempt 0..5 = MAX_RETRIES 5, last throws)
    expect(mockFetch).toHaveBeenCalledTimes(7)
  })
})

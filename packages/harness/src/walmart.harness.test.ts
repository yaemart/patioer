import { afterEach, describe, expect, it, vi } from 'vitest'
import { WalmartHarness } from './walmart.harness.js'
import type { WalmartCredentials } from './walmart.types.js'
import { resetSharedBuckets } from './token-bucket.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function makeCredentials(overrides: Partial<WalmartCredentials> = {}): WalmartCredentials {
  return {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    region: 'us',
    ...overrides,
  }
}

function makeHarness(credentials: Partial<WalmartCredentials> = {}): WalmartHarness {
  return new WalmartHarness('tenant-1', makeCredentials(credentials))
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
  resetSharedBuckets()
})

describe('WalmartHarness token refresh', () => {
  it('refreshes token via Client Credentials grant and caches', async () => {
    mockFetch.mockResolvedValue(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
    const harness = makeHarness()
    const ensure = harness as unknown as { ensureAccessToken: () => Promise<string> }

    const first = await ensure.ensureAccessToken()
    const second = await ensure.ensureAccessToken()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(first).toBe('tok-1')
    expect(second).toBe('tok-1')

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toContain('/v3/token')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toMatch(/^Basic /)
  })

  it('refreshes token again when cache is expired', async () => {
    mockFetch.mockResolvedValue(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
    const harness = makeHarness()
    const ensure = harness as unknown as { ensureAccessToken: () => Promise<string> }

    await ensure.ensureAccessToken()
    const mutableHarness = harness as unknown as { tokenExpiresAt: number }
    mutableHarness.tokenExpiresAt = Date.now() - 1_000
    mockFetch.mockResolvedValueOnce(ok({ access_token: 'tok-2', token_type: 'Bearer', expires_in: 900 }))

    const refreshed = await ensure.ensureAccessToken()
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(refreshed).toBe('tok-2')
  })

  it('throws HarnessError when token endpoint returns non-2xx', async () => {
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
      platform: 'walmart',
      code: 'auth_failed',
    })
  })

  it('deduplicates concurrent token refresh calls', async () => {
    mockFetch.mockResolvedValue(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
    const harness = makeHarness()
    const ensure = harness as unknown as { ensureAccessToken: () => Promise<string> }

    const [t1, t2, t3] = await Promise.all([
      ensure.ensureAccessToken(),
      ensure.ensureAccessToken(),
      ensure.ensureAccessToken(),
    ])

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(t1).toBe('tok-1')
    expect(t2).toBe('tok-1')
    expect(t3).toBe('tok-1')
  })
})

describe('WalmartHarness walmartFetch behavior', () => {
  it('sends correct headers including WM_SEC.ACCESS_TOKEN', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
      .mockResolvedValueOnce(ok({ ItemResponse: [] }))

    const harness = makeHarness()
    await harness.getProductsPage({ limit: 10 })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const apiCall = mockFetch.mock.calls[1]
    const init = apiCall[1] as RequestInit
    expect(init.headers).toMatchObject({
      'WM_SEC.ACCESS_TOKEN': 'tok-1',
      'Content-Type': 'application/json',
    })
  })

  it('retries on 429 and succeeds on later attempt', async () => {
    vi.useFakeTimers()
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce(ok({ ItemResponse: [] }))

    const task = makeHarness().getProductsPage()
    await vi.runAllTimersAsync()
    const page = await task

    expect(page.items).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('throws HarnessError after max retries on 5xx', async () => {
    vi.useFakeTimers()
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
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
      platform: 'walmart',
      code: '503',
    })
    await vi.runAllTimersAsync()
    await assertion
    expect(mockFetch).toHaveBeenCalledTimes(7)
  })
})

describe('WalmartHarness core methods', () => {
  it('getProductsPage maps items into Product domain model', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
      .mockResolvedValueOnce(
        ok({
          ItemResponse: [{ sku: 'SKU-1', productName: 'Widget', price: { amount: 9.99, currency: 'USD' } }],
          nextCursor: 'c-2',
        }),
      )

    const page = await makeHarness().getProductsPage({ limit: 1 })
    expect(page.nextCursor).toBe('c-2')
    expect(page.items).toEqual([
      {
        id: 'SKU-1',
        title: 'Widget',
        price: 9.99,
        inventory: null,
        sku: 'SKU-1',
        currency: 'USD',
        platformMeta: { platform: 'walmart', wpid: undefined, upc: undefined },
      },
    ])
  })

  it('getProducts sets truncated=true when nextCursor present', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
      .mockResolvedValueOnce(ok({ ItemResponse: [{ sku: 'SKU-1' }], nextCursor: 'c-2' }))

    const items = await makeHarness().getProducts()
    expect(items.truncated).toBe(true)
  })

  it('getProduct returns null for 404', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      })

    const product = await makeHarness().getProduct('nonexistent')
    expect(product).toBeNull()
  })

  it('updatePrice sends PUT request to /v3/prices', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
      .mockResolvedValueOnce(ok({}))

    await makeHarness().updatePrice('SKU-1', 14.99)

    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toContain('/v3/prices')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body as string)
    expect(body.sku).toBe('SKU-1')
    expect(body.pricing[0].currentPrice.amount).toBe(14.99)
  })

  it('updateInventory sends PUT request to /v3/inventory', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
      .mockResolvedValueOnce(ok({}))

    await makeHarness().updateInventory('SKU-1', 42)

    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toContain('/v3/inventory')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body as string)
    expect(body.quantity.amount).toBe(42)
  })

  it('getOrdersPage maps Walmart orders to Order domain model', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
      .mockResolvedValueOnce(
        ok({
          list: {
            elements: {
              order: [
                {
                  purchaseOrderId: 'PO-1',
                  customerOrderId: 'CO-1',
                  orderDate: '2026-03-01',
                  orderLines: {
                    orderLine: [
                      {
                        lineNumber: '1',
                        item: { sku: 'SKU-1' },
                        charges: { charge: [{ chargeAmount: { amount: 19.99 } }] },
                        orderLineStatuses: { orderLineStatus: [{ status: 'Shipped' }] },
                      },
                    ],
                  },
                },
              ],
            },
            meta: { nextCursor: 'c-2', totalCount: 10 },
          },
        }),
      )

    const page = await makeHarness().getOrdersPage({ limit: 5 })
    expect(page.nextCursor).toBe('c-2')
    expect(page.items).toEqual([{ id: 'PO-1', status: 'Shipped', totalPrice: 19.99 }])
  })

  it('replyToMessage throws not_implemented', async () => {
    await expect(makeHarness().replyToMessage('t-1', 'hi')).rejects.toMatchObject({
      type: 'harness_error',
      code: 'not_implemented',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('getOpenThreads throws not_implemented', async () => {
    await expect(makeHarness().getOpenThreads()).rejects.toMatchObject({
      type: 'harness_error',
      code: 'not_implemented',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('WalmartHarness getAnalytics', () => {
  it('calculates revenue and sets truncated correctly', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
      .mockResolvedValueOnce(
        ok({
          list: {
            elements: {
              order: [
                {
                  purchaseOrderId: 'PO-1',
                  customerOrderId: 'CO-1',
                  orderDate: '2026-03-01',
                  orderLines: {
                    orderLine: [
                      { lineNumber: '1', item: { sku: 'A' }, charges: { charge: [{ chargeAmount: { amount: 10 } }] } },
                    ],
                  },
                },
                {
                  purchaseOrderId: 'PO-2',
                  customerOrderId: 'CO-2',
                  orderDate: '2026-03-02',
                  orderLines: {
                    orderLine: [
                      { lineNumber: '1', item: { sku: 'B' }, charges: { charge: [{ chargeAmount: { amount: 25.5 } }] } },
                    ],
                  },
                },
              ],
            },
            meta: {},
          },
        }),
      )

    const analytics = await makeHarness().getAnalytics({ from: new Date(), to: new Date() })
    expect(analytics.revenue).toBeCloseTo(35.5)
    expect(analytics.orders).toBe(2)
    expect(analytics.truncated).toBe(false)
  })

  it('sets truncated=true at PAGE_LIMIT', async () => {
    const orders = Array.from({ length: 100 }, (_, i) => ({
      purchaseOrderId: `PO-${i}`,
      customerOrderId: `CO-${i}`,
      orderDate: '2026-03-01',
      orderLines: {
        orderLine: [{ lineNumber: '1', item: { sku: `S-${i}` }, charges: { charge: [{ chargeAmount: { amount: 1 } }] } }],
      },
    }))

    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
      .mockResolvedValueOnce(ok({ list: { elements: { order: orders }, meta: {} } }))

    const analytics = await makeHarness().getAnalytics({ from: new Date(), to: new Date() })
    expect(analytics.truncated).toBe(true)
    expect(analytics.orders).toBe(100)
  })
})

describe('WalmartHarness InventoryCapable', () => {
  it('getInventoryLevels fetches inventory by SKU', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
      .mockResolvedValueOnce(
        ok({
          inventoryItems: [{ sku: 'SKU-1', quantity: { unit: 'EACH', amount: 50 } }],
        }),
      )

    const harness = makeHarness()
    const levels = await harness.getInventoryLevels(['SKU-1'])

    expect(levels).toEqual([{ platformProductId: 'SKU-1', quantity: 50, sku: 'SKU-1' }])
  })

  it('getInventoryLevels without productIds fetches all', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 900 }))
      .mockResolvedValueOnce(
        ok({
          inventoryItems: [
            { sku: 'SKU-1', quantity: { unit: 'EACH', amount: 10 } },
            { sku: 'SKU-2', quantity: { unit: 'EACH', amount: 20 } },
          ],
        }),
      )

    const harness = makeHarness()
    const levels = await harness.getInventoryLevels()

    expect(levels).toHaveLength(2)
    expect(levels[0]?.quantity).toBe(10)
    expect(levels[1]?.quantity).toBe(20)
  })
})

describe('WalmartHarness sandbox/production switching', () => {
  it('uses sandbox URL by default', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok', token_type: 'Bearer', expires_in: 900 }))
      .mockResolvedValueOnce(ok({ ItemResponse: [] }))

    await makeHarness().getProductsPage()
    const apiUrl: string = mockFetch.mock.calls[1][0]
    expect(apiUrl).toContain('sandbox.walmartapis.com')
  })

  it('uses production URL when useSandbox=false', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok', token_type: 'Bearer', expires_in: 900 }))
      .mockResolvedValueOnce(ok({ ItemResponse: [] }))

    await makeHarness({ useSandbox: false }).getProductsPage()
    const apiUrl: string = mockFetch.mock.calls[1][0]
    expect(apiUrl).toContain('marketplace.walmartapis.com')
    expect(apiUrl).not.toContain('sandbox')
  })

  it('uses correct regional URL for CA', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ access_token: 'tok', token_type: 'Bearer', expires_in: 900 }))
      .mockResolvedValueOnce(ok({ ItemResponse: [] }))

    await makeHarness({ region: 'ca' }).getProductsPage()
    const apiUrl: string = mockFetch.mock.calls[1][0]
    expect(apiUrl).toContain('walmartapis.ca')
  })
})

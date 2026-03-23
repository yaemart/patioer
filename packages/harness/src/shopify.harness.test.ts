import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShopifyHarness } from './shopify.harness.js'
import { HarnessError } from './harness-error.js'
import { resetSharedBuckets } from './token-bucket.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function makeHarness() {
  return new ShopifyHarness('tenant-1', 'myshop.myshopify.com', 'test-access-token')
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

function okWithLink(body: unknown, link: string) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: (name: string) => (name.toLowerCase() === 'link' ? link : null) },
    json: () => Promise.resolve(body),
  }
}

function shopifyProduct(id = 1, price = '19.99', inventory = 10, inventoryItemId = 99) {
  return {
    id,
    title: `Product ${id}`,
    variants: [{ id: id * 10, price, inventory_quantity: inventory, inventory_item_id: inventoryItemId }],
  }
}

afterEach(() => {
  mockFetch.mockReset()
  resetSharedBuckets()
  vi.useRealTimers()
})

describe('ShopifyHarness.getProducts', () => {
  it('maps Shopify products to domain Product type', async () => {
    mockFetch.mockResolvedValue(ok({ products: [shopifyProduct(123, '19.99', 10)] }))

    const products = await makeHarness().getProducts()

    expect(products).toHaveLength(1)
    expect(products[0]).toEqual({
      id: '123',
      title: 'Product 123',
      price: 19.99,
      inventory: 10,
      variantCount: 1,
    })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/products.json'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Shopify-Access-Token': 'test-access-token' }),
      }),
    )
  })

  it('passes limit and cursor as query params', async () => {
    mockFetch.mockResolvedValue(ok({ products: [] }))

    await makeHarness().getProducts({ limit: 10, cursor: 'abc123' })

    const url: string = mockFetch.mock.calls[0][0]
    expect(url).toContain('limit=10')
    expect(url).toContain('page_info=abc123')
  })

  it('returns empty array when no products found', async () => {
    mockFetch.mockResolvedValue(ok({ products: [] }))
    expect(await makeHarness().getProducts()).toEqual([])
  })

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' })
    await expect(makeHarness().getProducts()).rejects.toThrow('Shopify API error 404')
  })

  it('returns nextCursor from Shopify Link header', async () => {
    mockFetch.mockResolvedValue(
      okWithLink(
        { products: [shopifyProduct(1)] },
        '<https://myshop.myshopify.com/admin/api/2024-01/products.json?page_info=abc123&limit=1>; rel="next"',
      ),
    )

    const page = await makeHarness().getProductsPage({ limit: 1 })

    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBe('abc123')
  })
})

describe('ShopifyHarness.updatePrice', () => {
  it('fetches product then PUTs the first variant price', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ product: shopifyProduct(1) }))
      .mockResolvedValueOnce(ok({ variant: { id: 10, price: '25.00' } }))

    await makeHarness().updatePrice('1', 25)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const putCall = mockFetch.mock.calls[1]
    expect(putCall[0]).toContain('/variants/10.json')
    expect(putCall[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ variant: { id: 10, price: '25.00' } }),
    })
  })

  it('throws when product has no variant', async () => {
    mockFetch.mockResolvedValue(ok({ product: { id: 1, title: 'X', variants: [] } }))
    await expect(makeHarness().updatePrice('1', 9.99)).rejects.toMatchObject({
      type: 'harness_error',
      code: 'variant_not_found',
    } satisfies Partial<HarnessError>)
  })
})

describe('ShopifyHarness.updateInventory', () => {
  it('sets inventory level using variant inventory_item_id and default location', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ product: shopifyProduct(5, '10.00', 3, 777) }))
      .mockResolvedValueOnce(ok({ locations: [{ id: 111 }] }))
      .mockResolvedValueOnce(ok({}))

    await makeHarness().updateInventory('5', 20)

    expect(mockFetch).toHaveBeenCalledTimes(3)
    const postCall = mockFetch.mock.calls[2]
    expect(postCall[0]).toContain('/inventory_levels/set.json')
    expect(JSON.parse(postCall[1].body as string)).toEqual({
      location_id: 111,
      inventory_item_id: 777,
      available: 20,
    })
  })

  it('throws when no location is found', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ product: shopifyProduct(5) }))
      .mockResolvedValueOnce(ok({ locations: [] }))

    await expect(makeHarness().updateInventory('5', 10)).rejects.toMatchObject({
      type: 'harness_error',
      code: 'location_not_found',
    } satisfies Partial<HarnessError>)
  })
})

describe('ShopifyHarness.getOrders', () => {
  it('maps Shopify orders to domain Order type', async () => {
    mockFetch.mockResolvedValue(
      ok({ orders: [{ id: 1001, financial_status: 'paid', total_price: '49.99' }] }),
    )

    const orders = await makeHarness().getOrders()

    expect(orders).toEqual([{ id: '1001', status: 'paid', totalPrice: 49.99 }])
  })

  it('includes status=any and limit in query params', async () => {
    mockFetch.mockResolvedValue(ok({ orders: [] }))

    await makeHarness().getOrders({ limit: 5 })

    const url: string = mockFetch.mock.calls[0][0]
    expect(url).toContain('status=any')
    expect(url).toContain('limit=5')
  })

  it('returns nextCursor for order pagination', async () => {
    mockFetch.mockResolvedValue(
      okWithLink(
        { orders: [{ id: 1, financial_status: 'paid', total_price: '9.00' }] },
        '<https://myshop.myshopify.com/admin/api/2024-01/orders.json?page_info=next-1&limit=1>; rel="next"',
      ),
    )

    const page = await makeHarness().getOrdersPage({ limit: 1 })

    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBe('next-1')
  })
})

describe('ShopifyHarness.getAnalytics', () => {
  it('sums revenue from paid orders in range', async () => {
    mockFetch.mockResolvedValue(
      ok({ orders: [{ total_price: '100.00' }, { total_price: '50.50' }] }),
    )

    const analytics = await makeHarness().getAnalytics({
      from: new Date('2024-01-01'),
      to: new Date('2024-01-31'),
    })

    expect(analytics.revenue).toBeCloseTo(150.5)
    expect(analytics.orders).toBe(2)
    expect(analytics.truncated).toBe(false)
  })

  it('returns zero analytics when no orders', async () => {
    mockFetch.mockResolvedValue(ok({ orders: [] }))
    const analytics = await makeHarness().getAnalytics({ from: new Date(), to: new Date() })
    expect(analytics).toEqual({ revenue: 0, orders: 0, truncated: false })
  })

  it('sets truncated=true when page size cap is hit', async () => {
    const orders = Array.from({ length: 250 }, () => ({ total_price: '1.00' }))
    mockFetch.mockResolvedValue(ok({ orders }))
    const analytics = await makeHarness().getAnalytics({ from: new Date(), to: new Date() })
    expect(analytics.truncated).toBe(true)
  })
})

describe('ShopifyHarness.getOpenThreads', () => {
  it('throws not_implemented (Shopify Inbox not wired)', async () => {
    await expect(makeHarness().getOpenThreads()).rejects.toMatchObject({
      type: 'harness_error',
      code: 'not_implemented',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('ShopifyHarness.replyToMessage', () => {
  it('throws not_implemented HarnessError until Inbox integration is wired', async () => {
    await expect(makeHarness().replyToMessage('thread-1', 'hello')).rejects.toMatchObject({
      type: 'harness_error',
      code: 'not_implemented',
    } satisfies Partial<HarnessError>)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('ShopifyHarness retry behavior', () => {
  it('retries on transient 5xx responses', async () => {
    vi.useFakeTimers()
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: { get: () => null },
      })
      .mockResolvedValueOnce(ok({ products: [] }))

    const task = makeHarness().getProducts()
    await vi.runAllTimersAsync()
    const products = await task

    expect(products).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('retries on network fetch errors before succeeding', async () => {
    vi.useFakeTimers()
    mockFetch
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(ok({ products: [] }))

    const task = makeHarness().getProducts()
    await vi.runAllTimersAsync()
    const products = await task

    expect(products).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

describe('Support Relay (Shopify Inbox)', () => {
  it('Support Relay: getOpenThreads throws not_implemented', async () => {
    await expect(makeHarness().getOpenThreads()).rejects.toMatchObject({
      type: 'harness_error',
      code: 'not_implemented',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

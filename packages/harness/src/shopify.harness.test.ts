import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShopifyHarness } from './shopify.harness.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function makeHarness() {
  return new ShopifyHarness('tenant-1', 'myshop.myshopify.com', 'test-access-token')
}

function ok(body: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) }
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
})

describe('ShopifyHarness.getProducts', () => {
  it('maps Shopify products to domain Product type', async () => {
    mockFetch.mockResolvedValue(ok({ products: [shopifyProduct(123, '19.99', 10)] }))

    const products = await makeHarness().getProducts()

    expect(products).toHaveLength(1)
    expect(products[0]).toEqual({ id: '123', title: 'Product 123', price: 19.99, inventory: 10 })
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
    await expect(makeHarness().updatePrice('1', 9.99)).rejects.toThrow('No variant found')
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

    await expect(makeHarness().updateInventory('5', 10)).rejects.toThrow('No Shopify fulfillment location')
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
  })

  it('returns zero analytics when no orders', async () => {
    mockFetch.mockResolvedValue(ok({ orders: [] }))
    const analytics = await makeHarness().getAnalytics({ from: new Date(), to: new Date() })
    expect(analytics).toEqual({ revenue: 0, orders: 0 })
  })
})

describe('ShopifyHarness.getOpenThreads', () => {
  it('returns empty array (Shopify Inbox not wired in MVP)', async () => {
    const threads = await makeHarness().getOpenThreads()
    expect(threads).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('ShopifyHarness.replyToMessage', () => {
  it('resolves without calling fetch (Shopify Inbox not wired in MVP)', async () => {
    await expect(makeHarness().replyToMessage('thread-1', 'hello')).resolves.toBeUndefined()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

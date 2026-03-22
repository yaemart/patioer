import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveHarness,
  mockHandleHarnessError,
  mockGetProductsPage,
} = vi.hoisted(() => ({
  mockResolveHarness: vi.fn(),
  mockHandleHarnessError: vi.fn(),
  mockGetProductsPage: vi.fn(),
}))

vi.mock('../lib/resolve-harness.js', () => ({
  resolveHarness: mockResolveHarness,
  handleHarnessError: mockHandleHarnessError,
}))

import productsRoute from './products.js'
import { HarnessError } from '@patioer/harness'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'

function createApp(
  responses: unknown[],
  options?: { withTenant?: boolean },
): ReturnType<typeof Fastify> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    if (options?.withTenant === false) {
      request.withDb = null
      request.tenantId = undefined
      return
    }
    request.tenantId = TENANT_ID
    request.withDb = async () => {
      if (responses.length === 0) throw new Error('withDb queue empty')
      return responses.shift() as never
    }
  })
  app.register(productsRoute)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetProductsPage.mockResolvedValue({ items: [] })
  mockResolveHarness.mockResolvedValue({
    ok: true,
    harness: { getProductsPage: mockGetProductsPage },
    platform: 'shopify',
    registryKey: `${TENANT_ID}:shopify`,
  })
})

describe('products route', () => {
  it('GET /products returns 401 without tenant header', async () => {
    const app = createApp([], { withTenant: false })
    const response = await app.inject({ method: 'GET', url: '/api/v1/products' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('GET /products returns empty array when no products', async () => {
    const app = createApp([[]])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ products: [] })
    await app.close()
  })

  it('GET /products returns product list for tenant', async () => {
    const rows = [
      { id: 'p-1', tenantId: TENANT_ID, title: 'Widget', price: '9.99', platform: 'shopify' },
    ]
    const app = createApp([rows])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/products',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ products: rows })
    await app.close()
  })

  it('POST /products/sync returns 401 without tenant header', async () => {
    mockResolveHarness.mockResolvedValueOnce({
      ok: false, statusCode: 401, body: { error: 'x-tenant-id required' },
    })
    const app = createApp([], { withTenant: false })
    const response = await app.inject({ method: 'POST', url: '/api/v1/products/sync' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('POST /products/sync returns 404 when no platform credentials found', async () => {
    mockResolveHarness.mockResolvedValueOnce({
      ok: false, statusCode: 404, body: { error: 'No platform credentials found' },
    })
    const app = createApp([])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products/sync',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'No platform credentials found' })
    await app.close()
  })

  it('POST /products/sync returns 503 when harness creation fails', async () => {
    mockResolveHarness.mockResolvedValueOnce({
      ok: false, statusCode: 503, body: { error: 'Platform integration not configured' },
    })
    const app = createApp([])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products/sync',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'Platform integration not configured' })
    await app.close()
  })

  it('POST /products/sync returns 0 when harness returns empty products list', async () => {
    mockGetProductsPage.mockResolvedValueOnce({ items: [] })
    const app = createApp([undefined])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products/sync',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ synced: 0 })
    await app.close()
  })

  it('POST /products/sync calls harness.getProductsPage and upserts rows', async () => {
    const products = [
      { id: 'sp-1', title: 'Widget', price: 9.99 },
      { id: 'sp-2', title: 'Gadget', price: 19.99 },
    ]
    mockGetProductsPage.mockResolvedValueOnce({ items: products })
    const app = createApp([undefined])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products/sync',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(mockGetProductsPage).toHaveBeenCalledOnce()
    await app.close()
  })

  it('POST /products/sync returns synced count matching harness products', async () => {
    const products = [
      { id: 'sp-1', title: 'Widget', price: 9.99 },
      { id: 'sp-2', title: 'Gadget', price: 19.99 },
      { id: 'sp-3', title: 'Doohickey', price: 4.99 },
    ]
    mockGetProductsPage.mockResolvedValueOnce({ items: products })
    const app = createApp([undefined])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products/sync',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ synced: 3 })
    await app.close()
  })

  it('POST /products/sync invokes withDb callbacks and upserts each product', async () => {
    const shopifyProducts = [
      { id: 'sp-1', title: 'Widget', price: 9.99 },
      { id: 'sp-2', title: 'Gadget', price: 19.99 },
    ]
    mockGetProductsPage.mockResolvedValueOnce({ items: shopifyProducts })

    const insertedValues: unknown[] = []
    const makeUpsertDb = () => ({
      insert: vi.fn().mockReturnValue({
        values: (v: unknown) => {
          insertedValues.push(v)
          return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }
        },
      }),
    })

    const app = Fastify({ logger: false })
    app.addHook('onRequest', async (request) => {
      request.tenantId = TENANT_ID
      request.withDb = (async <T>(callback: (db: never) => Promise<T>) => {
        return await callback(makeUpsertDb() as never)
      }) as never
    })
    app.register(productsRoute)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products/sync',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ synced: 2 })
    expect(insertedValues).toHaveLength(2)
    expect(insertedValues[0]).toMatchObject({ platformProductId: 'sp-1', title: 'Widget' })
    expect(insertedValues[1]).toMatchObject({ platformProductId: 'sp-2', title: 'Gadget' })
    await app.close()
  })

  it('POST /products/sync returns 503 and calls handleHarnessError on 401', async () => {
    const harnessErr = new HarnessError('shopify', '401', 'expired token')
    mockGetProductsPage.mockRejectedValueOnce(harnessErr)
    mockHandleHarnessError.mockReturnValueOnce({
      statusCode: 503,
      body: { error: 'shopify authorization expired; please reconnect' },
    })
    const app = createApp([undefined])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products/sync',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'shopify authorization expired; please reconnect' })
    expect(mockHandleHarnessError).toHaveBeenCalledWith(
      harnessErr, 'shopify', `${TENANT_ID}:shopify`, expect.any(String),
    )
    await app.close()
  })

  it('POST /products/sync returns 429 on rate-limit error', async () => {
    const harnessErr = new HarnessError('shopify', '429', 'too many requests')
    mockGetProductsPage.mockRejectedValueOnce(harnessErr)
    mockHandleHarnessError.mockReturnValueOnce({
      statusCode: 429,
      body: { error: 'shopify rate limit exceeded; retry later' },
    })
    const app = createApp([undefined])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products/sync',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(429)
    expect(response.json()).toEqual({ error: 'shopify rate limit exceeded; retry later' })
    await app.close()
  })

  it('POST /products/sync forwards cursor/limit and returns nextCursor', async () => {
    mockGetProductsPage.mockResolvedValueOnce({
      items: [{ id: 'sp-1', title: 'Widget', price: 9.99 }],
      nextCursor: 'cursor-next-1',
    })
    const app = createApp([undefined])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products/sync?cursor=cursor-0&limit=1',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(mockGetProductsPage).toHaveBeenCalledWith({ cursor: 'cursor-0', limit: 1 })
    expect(response.json()).toEqual({ synced: 1, nextCursor: 'cursor-next-1' })
    await app.close()
  })
})

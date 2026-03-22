import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptToken, mockGetOrCreate, mockGetProducts } = vi.hoisted(() => ({
  mockDecryptToken: vi.fn(),
  mockGetOrCreate: vi.fn(),
  mockGetProducts: vi.fn(),
}))

vi.mock('../lib/crypto.js', () => ({ decryptToken: mockDecryptToken }))
vi.mock('../lib/harness-registry.js', () => ({
  registry: { getOrCreate: mockGetOrCreate },
}))

import productsRoute from './products.js'

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
  process.env.SHOPIFY_ENCRYPTION_KEY = '0'.repeat(64)
  mockDecryptToken.mockReturnValue('plain-token')
  mockGetProducts.mockResolvedValue([])
  mockGetOrCreate.mockReturnValue({ getProducts: mockGetProducts })
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
    const app = createApp([], { withTenant: false })
    const response = await app.inject({ method: 'POST', url: '/api/v1/products/sync' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('POST /products/sync returns 503 when SHOPIFY_ENCRYPTION_KEY is not set', async () => {
    delete process.env.SHOPIFY_ENCRYPTION_KEY
    const app = createApp([])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products/sync',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'Shopify integration not configured' })
    await app.close()
  })

  it('POST /products/sync returns 404 when shopify credential is missing', async () => {
    const app = createApp([null])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products/sync',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'No Shopify credentials' })
    await app.close()
  })

  it('POST /products/sync returns 0 when harness returns empty products list', async () => {
    mockGetProducts.mockResolvedValueOnce([])
    const app = createApp([
      { accessToken: 'enc', shopDomain: 'demo.myshopify.com' },
      undefined,
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products/sync',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ synced: 0 })
    await app.close()
  })

  it('POST /products/sync calls harness.getProducts and upserts rows', async () => {
    const products = [
      { id: 'sp-1', title: 'Widget', price: 9.99 },
      { id: 'sp-2', title: 'Gadget', price: 19.99 },
    ]
    mockGetProducts.mockResolvedValueOnce(products)
    const app = createApp([
      { accessToken: 'enc', shopDomain: 'demo.myshopify.com' },
      undefined,
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products/sync',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(mockGetProducts).toHaveBeenCalledOnce()
    await app.close()
  })

  it('POST /products/sync returns synced count matching harness products', async () => {
    const products = [
      { id: 'sp-1', title: 'Widget', price: 9.99 },
      { id: 'sp-2', title: 'Gadget', price: 19.99 },
      { id: 'sp-3', title: 'Doohickey', price: 4.99 },
    ]
    mockGetProducts.mockResolvedValueOnce(products)
    const app = createApp([
      { accessToken: 'enc', shopDomain: 'demo.myshopify.com' },
      undefined,
    ])
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
    mockGetProducts.mockResolvedValueOnce(shopifyProducts)

    const insertedValues: unknown[] = []
    const makeUpsertDb = () => ({
      insert: vi.fn().mockReturnValue({
        values: (v: unknown) => {
          insertedValues.push(v)
          return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }
        },
      }),
    })
    const limit = vi.fn().mockResolvedValue([{ accessToken: 'enc', shopDomain: 'shop.myshopify.com' }])
    const where = vi.fn().mockReturnValue({ limit })
    const from = vi.fn().mockReturnValue({ where })
    const credDb = { select: vi.fn().mockReturnValue({ from }) }

    let callIndex = 0
    const app = Fastify({ logger: false })
    app.addHook('onRequest', async (request) => {
      request.tenantId = TENANT_ID
      request.withDb = (async <T>(callback: (db: never) => Promise<T>) => {
        callIndex += 1
        if (callIndex === 1) return await callback(credDb as never)
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

  it('POST /products/sync invokes ShopifyHarness factory when registry has no cached entry', async () => {
    mockGetProducts.mockResolvedValueOnce([])
    let factoryInvoked = false
    mockGetOrCreate.mockImplementation((_key: string, factory: () => unknown) => {
      factoryInvoked = true
      factory()
      return { getProducts: mockGetProducts }
    })

    const limit = vi.fn().mockResolvedValue([{ accessToken: 'enc', shopDomain: 'shop.myshopify.com' }])
    const where = vi.fn().mockReturnValue({ limit })
    const from = vi.fn().mockReturnValue({ where })
    const credDb = { select: vi.fn().mockReturnValue({ from }) }
    const upsertDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }
    let callIndex = 0
    const app = Fastify({ logger: false })
    app.addHook('onRequest', async (request) => {
      request.tenantId = TENANT_ID
      request.withDb = (async <T>(callback: (db: never) => Promise<T>) => {
        callIndex += 1
        if (callIndex === 1) return await callback(credDb as never)
        return await callback(upsertDb as never)
      }) as never
    })
    app.register(productsRoute)

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/products/sync',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(factoryInvoked).toBe(true)
    await app.close()
  })
})

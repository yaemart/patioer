import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveHarness,
  mockHandleHarnessError,
  mockGetOrdersPage,
} = vi.hoisted(() => ({
  mockResolveHarness: vi.fn(),
  mockHandleHarnessError: vi.fn(),
  mockGetOrdersPage: vi.fn(),
}))

vi.mock('../lib/resolve-harness.js', () => ({
  resolveHarness: mockResolveHarness,
  handleHarnessError: mockHandleHarnessError,
}))

import ordersRoute from './orders.js'
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
  app.register(ordersRoute)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetOrdersPage.mockResolvedValue({ items: [] })
  mockResolveHarness.mockResolvedValue({
    ok: true,
    harness: { getOrdersPage: mockGetOrdersPage },
    platform: 'shopify',
    registryKey: `${TENANT_ID}:shopify`,
  })
})

describe('orders route', () => {
  it('GET /orders returns 401 without tenant header', async () => {
    const app = createApp([], { withTenant: false })
    const response = await app.inject({ method: 'GET', url: '/api/v1/orders' })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'x-tenant-id required' })
    await app.close()
  })

  it('GET /orders returns empty array when no orders', async () => {
    const app = createApp([[]])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ orders: [] })
    await app.close()
  })

  it('GET /orders returns order list for tenant', async () => {
    const rows = [
      {
        id: 'o-1',
        tenantId: TENANT_ID,
        platformOrderId: '5001',
        platform: 'shopify',
        status: 'paid',
        totalPrice: '99.00',
      },
    ]
    const app = createApp([rows])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ orders: rows })
    await app.close()
  })

  it('GET /orders passes tenant context through withDb (RLS scope)', async () => {
    const capturedCallback: ((db: unknown) => unknown)[] = []
    const app = Fastify({ logger: false })
    app.addHook('onRequest', async (request) => {
      request.tenantId = TENANT_ID
      request.withDb = async (cb) => {
        capturedCallback.push(cb as (db: unknown) => unknown)
        return [] as never
      }
    })
    app.register(ordersRoute)

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(capturedCallback).toHaveLength(1)
    await app.close()
  })

  it('GET /orders/platform returns 401 without tenant header', async () => {
    mockResolveHarness.mockResolvedValueOnce({
      ok: false, statusCode: 401, body: { error: 'x-tenant-id required' },
    })
    const app = createApp([], { withTenant: false })
    const response = await app.inject({ method: 'GET', url: '/api/v1/orders/platform' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('GET /orders/platform returns 404 when no credentials found', async () => {
    mockResolveHarness.mockResolvedValueOnce({
      ok: false, statusCode: 404, body: { error: 'No platform credentials found' },
    })
    const app = createApp([])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/orders/platform',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'No platform credentials found' })
    await app.close()
  })

  it('GET /orders/platform passthrough returns orders + nextCursor', async () => {
    mockGetOrdersPage.mockResolvedValueOnce({
      items: [{ id: '5001', status: 'paid', totalPrice: 99 }],
      nextCursor: 'next-order-cursor',
    })
    const app = createApp([])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/orders/platform?cursor=cursor-0&limit=1',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(200)
    expect(mockGetOrdersPage).toHaveBeenCalledWith({ cursor: 'cursor-0', limit: 1 })
    expect(response.json()).toEqual({
      orders: [{ id: '5001', status: 'paid', totalPrice: 99 }],
      nextCursor: 'next-order-cursor',
    })
    await app.close()
  })

  it('GET /orders/platform returns 503 and calls handleHarnessError on 401', async () => {
    const harnessErr = new HarnessError('shopify', '401', 'expired token')
    mockGetOrdersPage.mockRejectedValueOnce(harnessErr)
    mockHandleHarnessError.mockReturnValueOnce({
      statusCode: 503,
      body: { error: 'shopify authorization expired; please reconnect' },
    })
    const app = createApp([])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/orders/platform',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'shopify authorization expired; please reconnect' })
    expect(mockHandleHarnessError).toHaveBeenCalledWith(
      harnessErr, 'shopify', `${TENANT_ID}:shopify`, expect.any(String),
    )
    await app.close()
  })

  it('GET /orders/platform returns 429 on rate limit', async () => {
    const harnessErr = new HarnessError('shopify', '429', 'too many requests')
    mockGetOrdersPage.mockRejectedValueOnce(harnessErr)
    mockHandleHarnessError.mockReturnValueOnce({
      statusCode: 429,
      body: { error: 'shopify rate limit exceeded; retry later' },
    })
    const app = createApp([])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/orders/platform',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(response.statusCode).toBe(429)
    expect(response.json()).toEqual({ error: 'shopify rate limit exceeded; retry later' })
    await app.close()
  })
})

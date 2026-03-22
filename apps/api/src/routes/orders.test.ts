import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import ordersRoute from './orders.js'

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
      request.withDb = async (cb: (db: unknown) => unknown) => {
        capturedCallback.push(cb)
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
})

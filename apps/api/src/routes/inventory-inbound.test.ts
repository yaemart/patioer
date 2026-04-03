import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import inventoryInboundRoute from './inventory-inbound.js'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'

function makeDb(rows: unknown[]) {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                orderBy() {
                  return { limit: async () => rows }
                },
              }
            },
          }
        },
      }
    },
  }
}

function createApp(rows: unknown[] = []) {
  const app = Fastify()

  app.decorateRequest('tenantId', '')
  app.decorateRequest('withDb', null)

  app.addHook('preHandler', async (req) => {
    const header = req.headers['x-tenant-id']
    if (typeof header === 'string') {
      const r = req as unknown as Record<string, unknown>
      r.tenantId = header
      r.withDb = async (fn: (db: unknown) => unknown) => fn(makeDb(rows))
    }
  })

  app.register(inventoryInboundRoute)
  return app
}

describe('GET /api/v1/inventory/inbound', () => {
  it('returns 401 without tenant', async () => {
    const app = createApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/inventory/inbound' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns empty shipments', async () => {
    const app = createApp([])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/inventory/inbound',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ shipments: [] })
    await app.close()
  })

  it('returns mapped shipments', async () => {
    const now = new Date()
    const app = createApp([
      {
        id: 'ship-1',
        tenantId: TENANT_ID,
        platform: 'amazon',
        productId: 'p-1',
        shipmentId: 'FBA-12345678',
        quantity: 500,
        status: 'in_transit',
        expectedArrival: '2026-04-15',
        createdAt: now,
      },
      {
        id: 'ship-2',
        tenantId: TENANT_ID,
        platform: 'shopify',
        productId: 'p-2',
        shipmentId: null,
        quantity: 200,
        status: 'delivered',
        expectedArrival: null,
        createdAt: now,
      },
    ])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/inventory/inbound',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.shipments).toHaveLength(2)
    expect(body.shipments[0]).toMatchObject({
      shipmentId: 'FBA-12345678',
      status: 'in_transit',
      quantityShipped: 500,
      quantityReceived: 0,
    })
    expect(body.shipments[1]).toMatchObject({
      status: 'delivered',
      quantityShipped: 200,
      quantityReceived: 200,
    })
    await app.close()
  })
})

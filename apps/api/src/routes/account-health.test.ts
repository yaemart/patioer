import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import accountHealthRoute from './account-health.js'

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

  app.register(accountHealthRoute)
  return app
}

describe('GET /api/v1/account-health', () => {
  it('returns 401 without tenant', async () => {
    const app = createApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/account-health' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns empty summary', async () => {
    const app = createApp([])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/account-health',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toEqual({
      total: 0,
      critical: 0,
      warning: 0,
      resolved: 0,
      events: [],
    })
    await app.close()
  })

  it('returns events with counts', async () => {
    const now = new Date()
    const app = createApp([
      {
        id: 'evt-1',
        tenantId: TENANT_ID,
        platform: 'amazon',
        eventType: 'policy_violation',
        severity: 'critical',
        title: 'Price parity violation',
        description: 'Listing flagged for price mismatch',
        affectedEntity: 'B0EXAMPLE1',
        resolvedAt: null,
        createdAt: now,
      },
      {
        id: 'evt-2',
        tenantId: TENANT_ID,
        platform: 'shopify',
        eventType: 'listing_issue',
        severity: 'warning',
        title: 'Missing image',
        description: null,
        affectedEntity: null,
        resolvedAt: now,
        createdAt: now,
      },
    ])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/account-health',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(2)
    expect(body.critical).toBe(1)
    expect(body.warning).toBe(1)
    expect(body.resolved).toBe(1)
    expect(body.events).toHaveLength(2)
    expect(body.events[0]).toMatchObject({
      id: 'evt-1',
      eventType: 'policy_violation',
      severity: 'critical',
      asin: 'B0EXAMPLE1',
    })
    await app.close()
  })
})

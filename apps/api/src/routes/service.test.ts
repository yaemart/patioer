import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import serviceRoute from './service.js'

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

  app.register(serviceRoute)
  return app
}

describe('GET /api/v1/service/cases', () => {
  it('returns 401 without tenant', async () => {
    const app = createApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/service/cases' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns empty cases', async () => {
    const app = createApp([])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/service/cases',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ cases: [] })
    await app.close()
  })

  it('returns mapped cases', async () => {
    const now = new Date()
    const app = createApp([
      {
        id: 'case-1',
        tenantId: TENANT_ID,
        platform: 'amazon',
        caseType: 'refund',
        status: 'open',
        customerMessage: 'Item damaged on arrival',
        escalated: true,
        resolvedAt: null,
        createdAt: now,
      },
    ])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/service/cases',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.cases).toHaveLength(1)
    expect(body.cases[0]).toMatchObject({
      id: 'case-1',
      platform: 'amazon',
      caseType: 'refund',
      status: 'open',
      priority: 'high',
    })
    await app.close()
  })
})

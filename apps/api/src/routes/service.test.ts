import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@patioer/harness', () => ({
  AmazonHealthHarness: vi.fn(),
}))

import { AmazonHealthHarness } from '@patioer/harness'
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

function makeRefundSummaryDb(rows: unknown[]) {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                orderBy() {
                  return Promise.resolve(rows)
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

function createRefundApp(rows: unknown[] = []) {
  const app = Fastify()

  app.decorateRequest('tenantId', '')
  app.decorateRequest('withDb', null)

  app.addHook('preHandler', async (req) => {
    const header = req.headers['x-tenant-id']
    if (typeof header === 'string') {
      const r = req as unknown as Record<string, unknown>
      r.tenantId = header
      r.withDb = async (fn: (db: unknown) => unknown) => fn(makeRefundSummaryDb(rows))
    }
  })

  app.register(serviceRoute)
  return app
}

function createThreadsApp() {
  const app = Fastify()

  app.decorateRequest('tenantId', '')
  app.decorateRequest('withDb', null)

  app.addHook('preHandler', async (req) => {
    const header = req.headers['x-tenant-id']
    if (typeof header === 'string') {
      const r = req as unknown as Record<string, unknown>
      r.tenantId = header
    }
  })

  app.register(serviceRoute)
  return app
}

beforeEach(() => {
  vi.mocked(AmazonHealthHarness).mockImplementation(function () {
    return {
      getSupportThreads: vi.fn().mockResolvedValue([]),
    } as unknown as InstanceType<typeof AmazonHealthHarness>
  })
})

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

describe('GET /api/v1/service/refund-summary', () => {
  it('returns 401 without tenant', async () => {
    const app = createRefundApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/service/refund-summary' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns empty summary', async () => {
    const app = createRefundApp([])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/service/refund-summary',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ totalRefunds: 0, totalAmount: 0, byStatus: {}, days: 30 })
    await app.close()
  })

  it('aggregates refunds by status and respects days query', async () => {
    const recent = new Date()
    const app = createRefundApp([
      {
        tenantId: TENANT_ID,
        caseType: 'refund',
        status: 'open',
        amount: '10.5',
        createdAt: recent,
      },
      {
        tenantId: TENANT_ID,
        caseType: 'refund',
        status: null,
        amount: 2,
        createdAt: recent,
      },
    ])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/service/refund-summary?days=7',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      totalRefunds: number
      totalAmount: number
      byStatus: Record<string, { count: number; amount: number }>
      days: number
    }
    expect(body.days).toBe(7)
    expect(body.totalRefunds).toBe(2)
    expect(body.totalAmount).toBe(12.5)
    expect(body.byStatus.open).toEqual({ count: 1, amount: 10.5 })
    expect(body.byStatus.unknown).toEqual({ count: 1, amount: 2 })
    await app.close()
  })

  it('falls back to 30 days when query is invalid', async () => {
    const app = createRefundApp([])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/service/refund-summary?days=0',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { days: number }).days).toBe(30)
    await app.close()
  })
})

describe('GET /api/v1/service/threads', () => {
  it('returns 401 without tenant', async () => {
    const app = createThreadsApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/service/threads' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns threads from harness', async () => {
    vi.mocked(AmazonHealthHarness).mockImplementation(function () {
      return {
        getSupportThreads: vi.fn().mockResolvedValue([{ id: 'thread-1' }]),
      } as unknown as InstanceType<typeof AmazonHealthHarness>
    })
    const app = createThreadsApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/service/threads',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ threads: [{ id: 'thread-1' }] })
    await app.close()
  })
})

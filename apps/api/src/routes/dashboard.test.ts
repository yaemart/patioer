import Fastify from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import dashboardRoute, { setDashboardDeps, type DashboardSummary } from './dashboard.js'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'

function buildSummary(): DashboardSummary {
  return {
    tenantId: TENANT_ID,
    plan: 'growth',
    agents: {
      active: 4,
      total: 5,
      limit: 7,
      recentlyActive: true,
      lastEventAt: '2026-03-29T10:00:00.000Z',
    },
    platforms: {
      connected: 2,
      limit: 3,
    },
    billing: {
      usedUsd: 123.45,
      budgetUsd: 500,
      remainingUsd: 376.55,
      isOverBudget: false,
    },
    approvals: {
      pending: 3,
    },
    onboarding: {
      currentStep: 7,
      completed: true,
      healthCheckPassed: true,
    },
  }
}

type SelectStep =
  | { rows: unknown[] }
  | { rows: unknown[]; limit: true }
  | { rows: unknown[]; limit: true; orderBy: true }

function makeDb(steps: SelectStep[]) {
  let idx = 0

  return {
    select() {
      const step = steps[idx++]
      if (!step) throw new Error('Unexpected select() call')

      return {
        from() {
          return {
            where() {
              if ('orderBy' in step && step.orderBy) {
                return {
                  orderBy() {
                    return {
                      limit: async () => step.rows,
                    }
                  },
                }
              }

              if ('limit' in step && step.limit) {
                return {
                  limit: async () => step.rows,
                }
              }

              return Promise.resolve(step.rows)
            },
          }
        },
      }
    },
  }
}

function buildApp(withTenant = true, options?: { db?: unknown; plan?: string }) {
  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    if (!withTenant) {
      request.tenantId = undefined
      request.withDb = null
      request.auth = null
      return
    }
    request.tenantId = TENANT_ID
    request.withDb = (async <T>(callback: (db: never) => Promise<T>) =>
      callback((options?.db ?? {}) as never)) as NonNullable<typeof request.withDb>
    request.auth = {
      userId: 'user-1',
      tenantId: TENANT_ID,
      email: 'dashboard@example.com',
      role: 'owner',
      plan: options?.plan ?? 'growth',
      subjectType: 'user',
      iat: 1,
      exp: 2,
    }
  })
  app.register(dashboardRoute)
  return app
}

describe('dashboard routes', () => {
  beforeEach(() => {
    setDashboardDeps({ summaryLoader: undefined })
  })

  it('returns dashboard summary for authenticated tenant', async () => {
    setDashboardDeps({ summaryLoader: async () => buildSummary() })
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/summary',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(buildSummary())
    await app.close()
  })

  it('returns 401 when tenant context is missing', async () => {
    const app = buildApp(false)
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/summary',
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'Authentication required' })
    await app.close()
  })

  it('uses the default summary loader for populated tenant data', async () => {
    const db = makeDb([
      { rows: [{ cnt: 2 }] },
      { rows: [{ cnt: 4 }] },
      { rows: [{ cnt: 3 }] },
      { rows: [{ total: '123.45' }] },
      { rows: [{ cnt: 1 }] },
      { rows: [{ currentStep: 6, completedAt: new Date('2026-03-29T10:00:00.000Z'), healthCheckPassed: true }], limit: true },
      { rows: [{ createdAt: new Date('2026-03-29T11:00:00.000Z') }], limit: true, orderBy: true },
      { rows: [{ cnt: 5 }] },
    ])

    const app = buildApp(true, { db })
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/summary',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      tenantId: TENANT_ID,
      plan: 'growth',
      agents: {
        active: 2,
        total: 4,
        limit: 7,
        recentlyActive: true,
        lastEventAt: '2026-03-29T11:00:00.000Z',
      },
      platforms: {
        connected: 3,
        limit: 3,
      },
      billing: {
        usedUsd: 123.45,
        budgetUsd: 500,
        remainingUsd: 376.55,
        isOverBudget: false,
      },
      approvals: {
        pending: 1,
      },
      onboarding: {
        currentStep: 6,
        completed: true,
        healthCheckPassed: true,
      },
    })
    await app.close()
  })

  it('falls back to starter defaults when optional dashboard data is missing', async () => {
    const db = makeDb([
      { rows: [{ cnt: 0 }] },
      { rows: [{ cnt: 1 }] },
      { rows: [{ cnt: 0 }] },
      { rows: [{ total: '25' }] },
      { rows: [{ cnt: 0 }] },
      { rows: [], limit: true },
      { rows: [], limit: true, orderBy: true },
      { rows: [{ cnt: 0 }] },
    ])

    const app = buildApp(true, { db, plan: 'not-a-plan' })
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/summary',
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      tenantId: TENANT_ID,
      plan: 'starter',
      agents: {
        active: 0,
        total: 1,
        limit: 3,
        recentlyActive: false,
        lastEventAt: null,
      },
      platforms: {
        connected: 0,
        limit: 1,
      },
      billing: {
        usedUsd: 25,
        budgetUsd: 160,
        remainingUsd: 135,
        isOverBudget: false,
      },
      approvals: {
        pending: 0,
      },
      onboarding: {
        currentStep: 1,
        completed: false,
        healthCheckPassed: false,
      },
    })
    await app.close()
  })
})

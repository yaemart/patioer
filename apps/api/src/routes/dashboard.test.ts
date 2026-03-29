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

function buildApp(withTenant = true) {
  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    if (!withTenant) {
      request.tenantId = undefined
      request.withDb = null
      request.auth = null
      return
    }
    request.tenantId = TENANT_ID
    request.withDb = (async <T>(callback: (db: never) => Promise<T>) => callback({} as never)) as NonNullable<typeof request.withDb>
    request.auth = {
      userId: 'user-1',
      tenantId: TENANT_ID,
      email: 'dashboard@example.com',
      role: 'owner',
      plan: 'growth',
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
    setDashboardDeps({ summaryLoader: async () => buildSummary() })
  })

  it('returns dashboard summary for authenticated tenant', async () => {
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
})

import { describe, expect, it, vi } from 'vitest'
import {
  calcHealthScore,
  createCustomerSuccessAgent,
} from './customer-success.agent.js'
import type {
  TenantMetrics,
  CsAgentDeps,
} from './customer-success.agent.js'
import { createTestContext } from './test-helpers.js'

function makeDeps(overrides: Partial<CsAgentDeps> = {}): CsAgentDeps {
  return {
    tenantStore: { getActiveTenantIds: vi.fn().mockResolvedValue(['t-1', 't-2', 't-3']) },
    metrics: {
      getTenantMetrics: vi.fn().mockImplementation(async (tenantId: string) => {
        const map: Record<string, TenantMetrics> = {
          't-1': { tenantId: 't-1', heartbeatSuccessRate: 0.98, loginCountLast30d: 15, avgApprovalResponseH: 2, gmv30dTrendPct: 12 },
          't-2': { tenantId: 't-2', heartbeatSuccessRate: 0.6, loginCountLast30d: 1, avgApprovalResponseH: 48, gmv30dTrendPct: -15 },
          't-3': { tenantId: 't-3', heartbeatSuccessRate: 0.9, loginCountLast30d: 5, avgApprovalResponseH: 10, gmv30dTrendPct: 0 },
        }
        return map[tenantId] ?? { tenantId, heartbeatSuccessRate: 0.95, loginCountLast30d: 5, avgApprovalResponseH: 10, gmv30dTrendPct: 0 }
      }),
    },
    email: { send: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  }
}

describe('calcHealthScore', () => {
  it('returns 100 for perfect metrics', () => {
    const m: TenantMetrics = {
      tenantId: 'perfect',
      heartbeatSuccessRate: 0.99,
      loginCountLast30d: 20,
      avgApprovalResponseH: 1,
      gmv30dTrendPct: 20,
    }
    const { score } = calcHealthScore(m)
    expect(score).toBe(100)
  })

  it('returns 20 for worst-case metrics', () => {
    const m: TenantMetrics = {
      tenantId: 'worst',
      heartbeatSuccessRate: 0.5,
      loginCountLast30d: 0,
      avgApprovalResponseH: 100,
      gmv30dTrendPct: -30,
    }
    const { score } = calcHealthScore(m)
    expect(score).toBe(20)
  })

  it('weights dimensions correctly', () => {
    const m: TenantMetrics = {
      tenantId: 'mixed',
      heartbeatSuccessRate: 0.99,
      loginCountLast30d: 1,
      avgApprovalResponseH: 1,
      gmv30dTrendPct: -20,
    }
    const { score, dimensions } = calcHealthScore(m)
    expect(dimensions).toHaveLength(4)
    expect(dimensions.find((d) => d.dimension === 'heartbeat_rate')!.score).toBe(100)
    expect(dimensions.find((d) => d.dimension === 'login_frequency')!.score).toBe(20)
    expect(dimensions.find((d) => d.dimension === 'gmv_trend')!.score).toBe(20)
    expect(score).toBe(Math.round(100 * 0.3 + 20 * 0.2 + 100 * 0.2 + 20 * 0.3))
  })
})

describe('createCustomerSuccessAgent', () => {
  it('scans all active tenants and returns results', async () => {
    const deps = makeDeps()
    const agent = createCustomerSuccessAgent(deps)
    const ctx = createTestContext('customer-success')

    const result = await agent.run(ctx, {})

    expect(result.tenantsScanned).toBe(3)
    expect(result.results).toHaveLength(3)
  })

  it('sends intervention for health < 40', async () => {
    const deps = makeDeps()
    const agent = createCustomerSuccessAgent(deps)
    const ctx = createTestContext('customer-success')

    const result = await agent.run(ctx, {})

    const t2 = result.results.find((r) => r.tenantId === 't-2')!
    expect(t2.score).toBeLessThan(40)
    expect(t2.action).toBe('intervention')
    expect(result.interventionsSent).toBe(1)
    expect(deps.email.send).toHaveBeenCalled()
  })

  it('sends upsell suggestion for health > 80', async () => {
    const deps = makeDeps()
    const agent = createCustomerSuccessAgent(deps)
    const ctx = createTestContext('customer-success')

    const result = await agent.run(ctx, {})

    const t1 = result.results.find((r) => r.tenantId === 't-1')!
    expect(t1.score).toBeGreaterThan(80)
    expect(t1.action).toBe('upsell_suggestion')
    expect(result.upsellsSuggested).toBe(1)
  })

  it('takes no action for mid-range health', async () => {
    const deps = makeDeps()
    const agent = createCustomerSuccessAgent(deps)
    const ctx = createTestContext('customer-success')

    const result = await agent.run(ctx, {})

    const t3 = result.results.find((r) => r.tenantId === 't-3')!
    expect(t3.score).toBeGreaterThanOrEqual(40)
    expect(t3.score).toBeLessThanOrEqual(80)
    expect(t3.action).toBe('none')
  })

  it('skips scanning when budget exceeded', async () => {
    const deps = makeDeps()
    const agent = createCustomerSuccessAgent(deps)
    const ctx = createTestContext('customer-success')
    vi.mocked(ctx.budget.isExceeded).mockResolvedValue(true)

    const result = await agent.run(ctx, {})

    expect(result.tenantsScanned).toBe(0)
    expect(deps.metrics.getTenantMetrics).not.toHaveBeenCalled()
  })

  it('accepts explicit tenantIds filter', async () => {
    const deps = makeDeps()
    const agent = createCustomerSuccessAgent(deps)
    const ctx = createTestContext('customer-success')

    const result = await agent.run(ctx, { tenantIds: ['t-1'] })

    expect(result.tenantsScanned).toBe(1)
    expect(result.results).toHaveLength(1)
    expect(result.results[0].tenantId).toBe('t-1')
  })

  it('creates a P1 ticket for intervention cases', async () => {
    const deps = makeDeps()
    const agent = createCustomerSuccessAgent(deps)
    const ctx = createTestContext('customer-success')

    await agent.run(ctx, { tenantIds: ['t-2'] })

    expect(ctx.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('t-2'),
      }),
    )
  })
})

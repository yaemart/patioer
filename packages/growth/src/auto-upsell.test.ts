import { describe, expect, it, vi } from 'vitest'
import { createAutoUpsellService } from './auto-upsell.js'
import type { AutoUpsellDeps, MonthlyUsageRecord } from './auto-upsell.js'

function makeDeps(plan: 'starter' | 'growth' | 'scale' = 'starter', records: MonthlyUsageRecord[] = []): AutoUpsellDeps {
  return {
    usage: { getRecentMonthlyUsage: vi.fn().mockResolvedValue(records) },
    tenantPlan: { getPlan: vi.fn().mockResolvedValue(plan) },
    email: { send: vi.fn().mockResolvedValue(undefined) },
  }
}

describe('auto-upsell', () => {
  it('triggers upsell when 2 consecutive months exceed 20%', async () => {
    const records: MonthlyUsageRecord[] = [
      { month: 1, year: 2026, totalCostUsd: 200 },
      { month: 2, year: 2026, totalCostUsd: 210 },
    ]
    const deps = makeDeps('starter', records)
    const svc = createAutoUpsellService(deps)

    const result = await svc.checkUpsellEligibility('t-1', 'user@example.com')

    expect(result.eligible).toBe(true)
    expect(result.suggestedPlan).toBe('growth')
    expect(result.emailSent).toBe(true)
    expect(result.overageMonths).toBe(2)
    expect(deps.email.send).toHaveBeenCalled()
  })

  it('does not trigger when overage < 20%', async () => {
    const records: MonthlyUsageRecord[] = [
      { month: 1, year: 2026, totalCostUsd: 170 },
      { month: 2, year: 2026, totalCostUsd: 175 },
    ]
    const deps = makeDeps('starter', records)
    const svc = createAutoUpsellService(deps)

    const result = await svc.checkUpsellEligibility('t-1', 'user@example.com')

    expect(result.eligible).toBe(false)
    expect(result.emailSent).toBe(false)
  })

  it('does not trigger with only 1 month over', async () => {
    const records: MonthlyUsageRecord[] = [
      { month: 1, year: 2026, totalCostUsd: 300 },
      { month: 2, year: 2026, totalCostUsd: 100 },
    ]
    const deps = makeDeps('starter', records)
    const svc = createAutoUpsellService(deps)

    const result = await svc.checkUpsellEligibility('t-1', 'user@example.com')

    expect(result.eligible).toBe(false)
    expect(result.overageMonths).toBe(1)
  })

  it('does not trigger for scale plan (no higher plan)', async () => {
    const records: MonthlyUsageRecord[] = [
      { month: 1, year: 2026, totalCostUsd: 2000 },
      { month: 2, year: 2026, totalCostUsd: 2100 },
    ]
    const deps = makeDeps('scale', records)
    const svc = createAutoUpsellService(deps)

    const result = await svc.checkUpsellEligibility('t-1', 'user@example.com')

    expect(result.eligible).toBe(false)
    expect(result.suggestedPlan).toBeNull()
    expect(result.emailSent).toBe(false)
  })

  it('suggests scale for growth plan overage', async () => {
    const records: MonthlyUsageRecord[] = [
      { month: 1, year: 2026, totalCostUsd: 650 },
      { month: 2, year: 2026, totalCostUsd: 700 },
    ]
    const deps = makeDeps('growth', records)
    const svc = createAutoUpsellService(deps)

    const result = await svc.checkUpsellEligibility('t-1', 'user@example.com')

    expect(result.eligible).toBe(true)
    expect(result.suggestedPlan).toBe('scale')
  })

  it('getNextPlan returns correct upgrades', () => {
    const deps = makeDeps()
    const svc = createAutoUpsellService(deps)

    expect(svc.getNextPlan('starter')).toBe('growth')
    expect(svc.getNextPlan('growth')).toBe('scale')
    expect(svc.getNextPlan('scale')).toBeNull()
  })
})

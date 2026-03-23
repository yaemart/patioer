import { describe, expect, it } from 'vitest'
import type { HarnessAdsCampaign } from '@patioer/harness'
import {
  APPROVAL_BUDGET_THRESHOLD_USD,
  DEFAULT_TARGET_ROAS,
  decideBudgetOptimization,
} from './ads-optimizer.decision.js'

function camp(partial: Partial<HarnessAdsCampaign> & Pick<HarnessAdsCampaign, 'platformCampaignId'>): HarnessAdsCampaign {
  return {
    name: 'C',
    status: 'active',
    ...partial,
  }
}

describe('decideBudgetOptimization', () => {
  it('does not increase when ROAS meets target (≥ 3)', () => {
    const d = decideBudgetOptimization(
      camp({ platformCampaignId: '1', roas: 3, dailyBudget: 100 }),
    )
    expect(d.action).toBe('none')
    if (d.action === 'none') expect(d.reason).toBe('roas_meets_target')
  })

  it('does not increase when ROAS above target', () => {
    const d = decideBudgetOptimization(
      camp({ platformCampaignId: '1', roas: 4, dailyBudget: 50 }),
    )
    expect(d.action).toBe('none')
  })

  it('proposes +10% when ROAS below target', () => {
    const d = decideBudgetOptimization(
      camp({ platformCampaignId: '1', roas: 2, dailyBudget: 400 }),
    )
    expect(d.action).toBe('increase_budget')
    if (d.action === 'increase_budget') {
      expect(d.proposedDailyBudgetUsd).toBe(440)
      expect(d.wouldRequireApproval).toBe(false)
    }
  })

  it('requires approval when proposed daily budget is greater than 500 USD', () => {
    const d = decideBudgetOptimization(
      camp({ platformCampaignId: '1', roas: 2, dailyBudget: 460 }),
    )
    expect(d.action).toBe('increase_budget')
    if (d.action === 'increase_budget') {
      expect(d.proposedDailyBudgetUsd).toBe(506)
      expect(d.wouldRequireApproval).toBe(true)
    }
  })

  it('does not require approval when proposed is at or below 500 (499 vs 501 boundary)', () => {
    const below = decideBudgetOptimization(
      camp({ platformCampaignId: 'a', roas: 2, dailyBudget: 454 }),
    )
    expect(below.action).toBe('increase_budget')
    if (below.action === 'increase_budget') {
      expect(below.proposedDailyBudgetUsd).toBeLessThanOrEqual(500)
      expect(below.wouldRequireApproval).toBe(false)
    }

    const above = decideBudgetOptimization(
      camp({ platformCampaignId: 'b', roas: 2, dailyBudget: 456 }),
    )
    expect(above.action).toBe('increase_budget')
    if (above.action === 'increase_budget') {
      expect(above.proposedDailyBudgetUsd).toBeGreaterThan(APPROVAL_BUDGET_THRESHOLD_USD)
      expect(above.wouldRequireApproval).toBe(true)
    }
  })

  it('respects custom targetRoas', () => {
    const d = decideBudgetOptimization(
      camp({ platformCampaignId: '1', roas: 2.5, dailyBudget: 100 }),
      { targetRoas: 2 },
    )
    expect(d.action).toBe('none')
  })

  it('uses default target ROAS 3', () => {
    expect(DEFAULT_TARGET_ROAS).toBe(3)
  })
})

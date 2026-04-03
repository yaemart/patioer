import type { HarnessAdsCampaign } from '@patioer/harness'

/** Product target from Sprint 4 plan (ROAS ≥ 3x). */
export const DEFAULT_TARGET_ROAS = 3

/** Daily budget above this (USD) requires approval before calling the platform (`docs/plans/phase2-plan.md`). */
export const APPROVAL_BUDGET_THRESHOLD_USD = 500

export type AdsBudgetDecision =
  | {
      action: 'none'
      proposedDailyBudgetUsd: null
      reason: 'roas_meets_target' | 'no_roas_data' | 'paused_or_ended' | 'no_budget_increase'
      /** True when we would increase but proposed exceeds threshold (for logging). */
      wouldRequireApproval: false
    }
  | {
      action: 'increase_budget'
      proposedDailyBudgetUsd: number
      reason: 'roas_below_target'
      wouldRequireApproval: boolean
    }

/**
 * Pure decision: if ROAS is below target, propose a +10% daily budget bump (minimum $1 when current is 0).
 * If the proposed budget is **greater than** {@link APPROVAL_BUDGET_THRESHOLD_USD}, the runner must
 * call `requestApproval` and must **not** call `updateAdsBudget`.
 */
export function decideBudgetOptimization(
  campaign: HarnessAdsCampaign,
  opts: { targetRoas?: number; approvalThresholdUsd?: number } = {},
): AdsBudgetDecision {
  const targetRoas = opts.targetRoas ?? DEFAULT_TARGET_ROAS
  const approvalThreshold = opts.approvalThresholdUsd ?? APPROVAL_BUDGET_THRESHOLD_USD

  if (campaign.status !== 'active') {
    return {
      action: 'none',
      proposedDailyBudgetUsd: null,
      reason: 'paused_or_ended',
      wouldRequireApproval: false,
    }
  }

  const roas = campaign.roas
  if (roas == null || !Number.isFinite(roas)) {
    return {
      action: 'none',
      proposedDailyBudgetUsd: null,
      reason: 'no_roas_data',
      wouldRequireApproval: false,
    }
  }

  if (roas >= targetRoas) {
    return {
      action: 'none',
      proposedDailyBudgetUsd: null,
      reason: 'roas_meets_target',
      wouldRequireApproval: false,
    }
  }

  const current = campaign.dailyBudget ?? 0
  let proposed: number
  if (current <= 0) {
    proposed = 50
  } else {
    proposed = Math.round(current * 1.1 * 100) / 100
    if (proposed <= current) {
      proposed = Math.round((current + 1) * 100) / 100
    }
  }

  const wouldRequireApproval = proposed > approvalThreshold

  return {
    action: 'increase_budget',
    proposedDailyBudgetUsd: proposed,
    reason: 'roas_below_target',
    wouldRequireApproval,
  }
}

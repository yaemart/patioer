import type { PlanName } from '@patioer/shared'
import { PLAN_BUDGET_USD, PLAN_NAMES } from '@patioer/shared'

export interface MonthlyUsageRecord {
  month: number
  year: number
  totalCostUsd: number
}

export interface UsageQueryPort {
  getRecentMonthlyUsage(tenantId: string, months: number): Promise<MonthlyUsageRecord[]>
}

export interface TenantPlanPort {
  getPlan(tenantId: string): Promise<PlanName>
}

export interface UpsellEmailSender {
  send(params: { to: string; subject: string; body: string }): Promise<void>
}

export interface AutoUpsellDeps {
  usage: UsageQueryPort
  tenantPlan: TenantPlanPort
  email: UpsellEmailSender
}

const OVERAGE_THRESHOLD_PCT = 20
const CONSECUTIVE_MONTHS = 2

function getNextPlan(current: PlanName): PlanName | null {
  const idx = PLAN_NAMES.indexOf(current)
  if (idx < 0 || idx >= PLAN_NAMES.length - 1) return null
  return PLAN_NAMES[idx + 1]
}

export interface UpsellCheckResult {
  tenantId: string
  eligible: boolean
  currentPlan: PlanName
  suggestedPlan: PlanName | null
  overageMonths: number
  avgOveragePct: number
  emailSent: boolean
}

export function createAutoUpsellService(deps: AutoUpsellDeps) {
  async function checkUpsellEligibility(
    tenantId: string,
    email: string,
  ): Promise<UpsellCheckResult> {
    const plan = await deps.tenantPlan.getPlan(tenantId)
    const budget = PLAN_BUDGET_USD[plan]
    const records = await deps.usage.getRecentMonthlyUsage(tenantId, CONSECUTIVE_MONTHS)

    const overageMonths = records.filter((r) => {
      const overagePct = ((r.totalCostUsd - budget) / budget) * 100
      return overagePct > OVERAGE_THRESHOLD_PCT
    })

    const avgOveragePct = overageMonths.length === 0
      ? 0
      : Math.round(
        overageMonths.reduce((sum, r) => sum + ((r.totalCostUsd - budget) / budget) * 100, 0)
        / overageMonths.length,
      )

    const suggestedPlan = getNextPlan(plan)
    const eligible = overageMonths.length >= CONSECUTIVE_MONTHS && suggestedPlan !== null

    let emailSent = false

    if (eligible && suggestedPlan) {
      const suggestedBudget = PLAN_BUDGET_USD[suggestedPlan]
      await deps.email.send({
        to: email,
        subject: `[ElectroOS] Your agents are consistently over budget — consider upgrading to ${suggestedPlan}`,
        body: [
          `Your ${plan} plan has a monthly budget of $${budget}.`,
          `Over the last ${CONSECUTIVE_MONTHS} months, your usage has exceeded budget by an average of ${avgOveragePct}%.`,
          '',
          `Upgrading to ${suggestedPlan} ($${suggestedBudget}/month budget) would eliminate overage charges`,
          'and unlock additional agents and platform connections.',
          '',
          'Visit your dashboard settings to upgrade.',
        ].join('\n'),
      })
      emailSent = true
    }

    return {
      tenantId,
      eligible,
      currentPlan: plan,
      suggestedPlan,
      overageMonths: overageMonths.length,
      avgOveragePct,
      emailSent,
    }
  }

  return { checkUpsellEligibility, getNextPlan }
}

export type AutoUpsellService = ReturnType<typeof createAutoUpsellService>

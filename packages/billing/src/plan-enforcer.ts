import type { PlanName } from './billing.types.js'
import {
  PLAN_AGENT_LIMITS,
  PLAN_PLATFORM_LIMITS,
  PLAN_DATAOS_TIER,
  PLAN_BUDGET_USD,
} from '@patioer/shared'

export interface PlanEnforcementResult {
  allowed: boolean
  reason?: string
}

export function canUseAgent(plan: PlanName, agentId: string): PlanEnforcementResult {
  const allowed = PLAN_AGENT_LIMITS[plan].includes(agentId)
  return allowed
    ? { allowed: true }
    : { allowed: false, reason: `Agent "${agentId}" is not included in the ${plan} plan` }
}

export function canAddPlatform(plan: PlanName, currentCount: number): PlanEnforcementResult {
  const limit = PLAN_PLATFORM_LIMITS[plan]
  const allowed = currentCount < limit
  return allowed
    ? { allowed: true }
    : { allowed: false, reason: `Platform limit reached (${limit}) for the ${plan} plan` }
}

export function canUseDataOS(plan: PlanName): PlanEnforcementResult {
  const tier = PLAN_DATAOS_TIER[plan]
  if (tier === 'none') {
    return { allowed: false, reason: `DataOS is not available on the ${plan} plan` }
  }
  return { allowed: true }
}

export function getMonthlyBudget(plan: PlanName): number {
  return PLAN_BUDGET_USD[plan]
}

export function getDataOSTier(plan: PlanName): 'none' | 'partial' | 'full' {
  return PLAN_DATAOS_TIER[plan]
}

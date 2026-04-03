import type { AgentError } from '@patioer/shared'
import type { AgentContext } from './context.js'
import type { DegradationFlags, GovernedAction } from './decision-pipeline.js'
import { NO_DEGRADATION } from './decision-pipeline.js'

// ---------------------------------------------------------------------------
// Detect degradation flags from runtime context
// ---------------------------------------------------------------------------

export interface DegradationDetectOptions {
  scope: string
  platform?: string
}

export async function detectDegradation(
  ctx: AgentContext,
  options: DegradationDetectOptions,
): Promise<DegradationFlags> {
  const flags = { ...NO_DEGRADATION }

  if (ctx.business) {
    const today = new Date()
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 86_400_000)
    const range = { from: thirtyDaysAgo, to: today }

    const overview = await ctx.business.unitEconomics.getDailyOverview(range)
    if (overview.length === 0) {
      flags.profitDataMissing = true
    }

    if (options.platform) {
      const health = await ctx.business.accountHealth.getHealthSummary(options.platform)
      if (health.overallStatus === 'critical') {
        flags.accountHealthCritical = true
      }
    }

    const recentOverview = overview.slice(-7)
    if (recentOverview.length >= 3) {
      const negativeMarginDays = recentOverview.filter(
        (d) => d.contributionMargin < 0,
      ).length
      if (negativeMarginDays >= 3) {
        flags.cashFlowTight = true
      }
    }
  } else {
    flags.profitDataMissing = true
  }

  return flags
}

/**
 * Build an AgentError of type 'degraded_mode' from a triggered flag.
 * Callers can log this to agent_events for observability.
 */
export function buildDegradedModeError(
  agentId: string,
  flags: DegradationFlags,
): AgentError | null {
  if (flags.profitDataMissing) {
    return { type: 'degraded_mode', reason: 'missing_profit_data', agentId }
  }
  if (flags.accountHealthCritical) {
    return { type: 'degraded_mode', reason: 'account_health_risk', agentId }
  }
  if (flags.cashFlowTight) {
    return { type: 'degraded_mode', reason: 'cash_flow_pressure', agentId }
  }
  return null
}

// ---------------------------------------------------------------------------
// Apply degradation to a governed action
// ---------------------------------------------------------------------------

export interface DegradationRule {
  flag: keyof DegradationFlags
  effect: GovernedAction
  reason: string
}

const DEFAULT_RULES: Record<string, DegradationRule[]> = {
  'price-sentinel': [
    { flag: 'profitDataMissing', effect: 'degraded_suggest_only', reason: 'Profit data missing — cannot auto-execute price changes' },
    { flag: 'accountHealthCritical', effect: 'requires_approval', reason: 'Account health critical — price changes require approval' },
    { flag: 'cashFlowTight', effect: 'requires_approval', reason: 'Cash flow under pressure — price reductions require approval' },
  ],
  'ads-optimizer': [
    { flag: 'profitDataMissing', effect: 'degraded_suggest_only', reason: 'Profit data missing — cannot auto-adjust ad budgets' },
    { flag: 'accountHealthCritical', effect: 'blocked', reason: 'Account health critical — ad spending suspended' },
    { flag: 'cashFlowTight', effect: 'requires_approval', reason: 'Cash flow tight — budget increases require approval' },
  ],
  'inventory-guard': [
    { flag: 'profitDataMissing', effect: 'requires_approval', reason: 'Profit data missing — replenishment needs manual review' },
    { flag: 'accountHealthCritical', effect: 'requires_approval', reason: 'Account health critical — large orders need approval' },
    { flag: 'cashFlowTight', effect: 'degraded_suggest_only', reason: 'Cash flow tight — only outputting priority ranking, no purchase orders' },
  ],
}

const ACTION_SEVERITY: Record<GovernedAction, number> = {
  blocked: 3,
  degraded_suggest_only: 2,
  requires_approval: 1,
  auto_execute: 0,
}

export function applyDegradation(
  scope: string,
  baseAction: GovernedAction,
  flags: DegradationFlags,
): { action: GovernedAction; reasons: string[] } {
  const rules = DEFAULT_RULES[scope] ?? []
  let action = baseAction
  const reasons: string[] = []

  for (const rule of rules) {
    if (!flags[rule.flag]) continue
    if (ACTION_SEVERITY[rule.effect] > ACTION_SEVERITY[action]) {
      action = rule.effect
    }
    reasons.push(rule.reason)
  }

  return { action, reasons }
}

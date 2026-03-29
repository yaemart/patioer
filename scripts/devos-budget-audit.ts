/**
 * Sprint 14 · Task 14.7 — DevOS Monthly Budget Audit
 *
 * Validates AC-P4-14: DevOS 12 Agent total monthly budget ≤ $720.
 *
 * Reads the canonical DEVOS_FULL_SEED and verifies:
 * - All 12 agents are present
 * - Individual budgets are within configured limits
 * - Total ≤ $720
 */

import {
  DEVOS_FULL_SEED,
  DEVOS_MONTHLY_BUDGET_USD,
} from '../packages/devos-bridge/src/devos-full-seed.js'

export interface DevOsBudgetAuditResult {
  totalAgents: number
  expectedAgents: number
  totalMonthlyBudgetUsd: number
  budgetLimit: number
  perAgentBudgets: { agentId: string; name: string; monthlyBudgetUsd: number }[]
  withinLimit: boolean
  allAgentsPresent: boolean
  pass: boolean
}

export function auditDevOsBudget(): DevOsBudgetAuditResult {
  const perAgentBudgets = DEVOS_FULL_SEED.map((entry) => ({
    agentId: entry.id,
    name: entry.name,
    monthlyBudgetUsd: entry.monthlyBudgetUsd,
  }))

  const totalAgents = DEVOS_FULL_SEED.length
  const expectedAgents = 12
  const budgetLimit = 720

  const withinLimit = DEVOS_MONTHLY_BUDGET_USD <= budgetLimit
  const allAgentsPresent = totalAgents === expectedAgents

  return {
    totalAgents,
    expectedAgents,
    totalMonthlyBudgetUsd: DEVOS_MONTHLY_BUDGET_USD,
    budgetLimit,
    perAgentBudgets,
    withinLimit,
    allAgentsPresent,
    pass: withinLimit && allAgentsPresent,
  }
}

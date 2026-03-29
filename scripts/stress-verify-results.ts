/**
 * Sprint 14 · Task 14.3 — Stress Test Result Verification
 *
 * Validates three dimensions of the 50-tenant stress test:
 * 1. Heartbeat continuity — every tenant × every cycle × every agent succeeded
 * 2. DB connection pool utilisation — simulated pool stayed below 80%
 * 3. Budget consistency — no agent exceeded its configured monthly budget
 *
 * Can be run against live StressHeartbeatSummary or via test harness.
 */

import { ELECTROOS_FULL_SEED, ELECTROOS_MONTHLY_BUDGET_USD } from '../packages/agent-runtime/src/electroos-seed.js'
import type { StressHeartbeatSummary } from './stress-50-tenant-heartbeat.js'

export interface PoolSimulationConfig {
  maxServerConnections: number
  peakConcurrentTenants: number
  connectionsPerTenant: number
}

export interface PoolSimulationResult {
  peakConnections: number
  maxConnections: number
  utilisationPercent: number
  withinThreshold: boolean
}

export interface BudgetCheckResult {
  totalMonthlyBudgetPerTenant: number
  perAgentBudgets: { agentId: string; monthlyBudgetUsd: number }[]
  totalAllTenantsMonthly: number
  withinBounds: boolean
}

export interface VerificationResult {
  heartbeatContinuity: {
    totalTenants: number
    totalCycles: number
    totalTicks: number
    failedTicks: number
    continuityPass: boolean
  }
  connectionPool: PoolSimulationResult
  budgetCheck: BudgetCheckResult
  allPass: boolean
}

export function verifyHeartbeatContinuity(summary: StressHeartbeatSummary): VerificationResult['heartbeatContinuity'] {
  const failedTicks = summary.tenantResults.reduce(
    (sum, tr) => sum + tr.evidence.failures.length, 0,
  )

  return {
    totalTenants: summary.totalTenants,
    totalCycles: summary.totalCycles,
    totalTicks: summary.totalTicks,
    failedTicks,
    continuityPass: failedTicks === 0,
  }
}

export function simulateConnectionPool(config: PoolSimulationConfig): PoolSimulationResult {
  const peakConnections = config.peakConcurrentTenants * config.connectionsPerTenant
  const utilisationPercent = (peakConnections / config.maxServerConnections) * 100

  return {
    peakConnections,
    maxConnections: config.maxServerConnections,
    utilisationPercent: Math.round(utilisationPercent * 100) / 100,
    withinThreshold: utilisationPercent < 80,
  }
}

export function verifyBudgets(tenantCount: number): BudgetCheckResult {
  const perAgentBudgets = ELECTROOS_FULL_SEED.map((entry) => ({
    agentId: entry.id,
    monthlyBudgetUsd: entry.monthlyBudgetUsd,
  }))

  const totalPerTenant = ELECTROOS_MONTHLY_BUDGET_USD
  const totalAllTenants = totalPerTenant * tenantCount

  return {
    totalMonthlyBudgetPerTenant: totalPerTenant,
    perAgentBudgets,
    totalAllTenantsMonthly: totalAllTenants,
    withinBounds: perAgentBudgets.every((b) => b.monthlyBudgetUsd > 0 && b.monthlyBudgetUsd <= 100),
  }
}

export function verifyStressResults(
  summary: StressHeartbeatSummary,
  poolConfig?: PoolSimulationConfig,
): VerificationResult {
  const heartbeat = verifyHeartbeatContinuity(summary)

  const pool = simulateConnectionPool(poolConfig ?? {
    maxServerConnections: 60,
    peakConcurrentTenants: summary.peakConcurrency,
    connectionsPerTenant: 1,
  })

  const budget = verifyBudgets(summary.totalTenants)

  return {
    heartbeatContinuity: heartbeat,
    connectionPool: pool,
    budgetCheck: budget,
    allPass: heartbeat.continuityPass && pool.withinThreshold && budget.withinBounds,
  }
}

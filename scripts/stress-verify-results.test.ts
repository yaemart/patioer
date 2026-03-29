import { describe, it, expect } from 'vitest'
import { runStressHeartbeat } from './stress-50-tenant-heartbeat.js'
import {
  verifyStressResults,
  verifyHeartbeatContinuity,
  simulateConnectionPool,
  verifyBudgets,
} from './stress-verify-results.js'

describe('stress-verify-results', () => {
  it('heartbeat continuity passes with zero failures', async () => {
    const summary = await runStressHeartbeat({ tenantCount: 5, cyclesPerTenant: 2 })
    const result = verifyHeartbeatContinuity(summary)

    expect(result.totalTenants).toBe(5)
    expect(result.totalCycles).toBe(10)
    expect(result.totalTicks).toBe(90)
    expect(result.failedTicks).toBe(0)
    expect(result.continuityPass).toBe(true)
  })

  it('connection pool simulation stays below 80% for 10 concurrent tenants', () => {
    const result = simulateConnectionPool({
      maxServerConnections: 60,
      peakConcurrentTenants: 10,
      connectionsPerTenant: 1,
    })

    expect(result.peakConnections).toBe(10)
    expect(result.utilisationPercent).toBeLessThan(80)
    expect(result.withinThreshold).toBe(true)
  })

  it('connection pool simulation detects >80% utilisation', () => {
    const result = simulateConnectionPool({
      maxServerConnections: 60,
      peakConcurrentTenants: 50,
      connectionsPerTenant: 1,
    })

    expect(result.utilisationPercent).toBe(83.33)
    expect(result.withinThreshold).toBe(false)
  })

  it('budget check validates all 9 agents have reasonable budgets', () => {
    const result = verifyBudgets(50)

    expect(result.perAgentBudgets).toHaveLength(9)
    expect(result.totalMonthlyBudgetPerTenant).toBeGreaterThan(0)
    expect(result.totalAllTenantsMonthly).toBe(result.totalMonthlyBudgetPerTenant * 50)
    expect(result.withinBounds).toBe(true)
  })

  it('full verification passes for 50 tenants with controlled concurrency', async () => {
    const summary = await runStressHeartbeat({
      tenantCount: 50,
      cyclesPerTenant: 2,
      concurrency: 10,
    })

    const verification = verifyStressResults(summary)

    expect(verification.heartbeatContinuity.continuityPass).toBe(true)
    expect(verification.connectionPool.withinThreshold).toBe(true)
    expect(verification.budgetCheck.withinBounds).toBe(true)
    expect(verification.allPass).toBe(true)
  })

  it('AC-P4-19: 50 tenants concurrent heartbeat with zero failures', async () => {
    const summary = await runStressHeartbeat({
      tenantCount: 50,
      cyclesPerTenant: 3,
      concurrency: 10,
    })

    const verification = verifyStressResults(summary)

    expect(summary.totalTenants).toBe(50)
    expect(summary.totalFailures).toBe(0)
    expect(summary.allHealthy).toBe(true)
    expect(verification.allPass).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { runHealthCheck, createNoopDeps } from './health-check.js'
import type { HealthCheckDeps } from './health-check.js'

function makeDeps(overrides: Partial<HealthCheckDeps> = {}): HealthCheckDeps {
  return { ...createNoopDeps(), ...overrides }
}

describe('health-check', () => {
  it('passes when all checks succeed', async () => {
    const deps = makeDeps({
      async checkApiConnectivity() { return { ok: true, latencyMs: 42 } },
      async checkAgentHeartbeat() { return { ok: true, activeAgents: 3, totalAgents: 3 } },
      async checkDataPipeline() { return { ok: true, lastEventAge: 5 } },
      async checkApprovalSystem() { return { ok: true, pendingCount: 2 } },
    })

    const report = await runHealthCheck(deps)
    expect(report.passed).toBe(true)
    expect(report.items).toHaveLength(4)
    expect(report.items.every((i) => i.passed)).toBe(true)
    expect(report.checkedAt).toBeInstanceOf(Date)
  })

  it('fails when API connectivity fails', async () => {
    const deps = makeDeps({
      async checkApiConnectivity() { return { ok: false, latencyMs: 0 } },
    })

    const report = await runHealthCheck(deps)
    expect(report.passed).toBe(false)
    const apiItem = report.items.find((i) => i.category === 'api_connectivity')
    expect(apiItem?.passed).toBe(false)
    expect(apiItem?.message).toBe('API unreachable')
  })

  it('fails when agent heartbeat fails', async () => {
    const deps = makeDeps({
      async checkAgentHeartbeat() { return { ok: false, activeAgents: 1, totalAgents: 5 } },
    })

    const report = await runHealthCheck(deps)
    expect(report.passed).toBe(false)
    const agentItem = report.items.find((i) => i.category === 'agent_heartbeat')
    expect(agentItem?.passed).toBe(false)
    expect(agentItem?.message).toContain('1/5')
  })

  it('handles exceptions gracefully', async () => {
    const deps = makeDeps({
      async checkApiConnectivity() { throw new Error('network error') },
      async checkDataPipeline() { throw new Error('timeout') },
    })

    const report = await runHealthCheck(deps)
    expect(report.passed).toBe(false)
    const apiItem = report.items.find((i) => i.category === 'api_connectivity')
    expect(apiItem?.passed).toBe(false)
    expect(apiItem?.message).toContain('threw an error')
  })

  it('records duration for each check', async () => {
    const deps = makeDeps()
    const report = await runHealthCheck(deps)
    for (const item of report.items) {
      expect(item.durationMs).toBeGreaterThanOrEqual(0)
    }
    expect(report.totalDurationMs).toBeGreaterThanOrEqual(0)
  })

  it('includes all four check categories', async () => {
    const deps = makeDeps()
    const report = await runHealthCheck(deps)
    const categories = report.items.map((i) => i.category)
    expect(categories).toContain('api_connectivity')
    expect(categories).toContain('agent_heartbeat')
    expect(categories).toContain('data_pipeline')
    expect(categories).toContain('approval_system')
  })

  it('shows pipeline last event age in message', async () => {
    const deps = makeDeps({
      async checkDataPipeline() { return { ok: true, lastEventAge: 30 } },
    })

    const report = await runHealthCheck(deps)
    const pipeItem = report.items.find((i) => i.category === 'data_pipeline')
    expect(pipeItem?.message).toContain('30s ago')
  })
})

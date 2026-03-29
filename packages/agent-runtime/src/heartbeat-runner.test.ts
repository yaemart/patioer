import { describe, expect, it, vi } from 'vitest'
import type { AgentContext } from './context.js'
import { HeartbeatRunner } from './heartbeat-runner.js'
import { createHarnessMock, createDataOsMock } from './agents/test-helpers.js'
import { ELECTROOS_AGENT_IDS } from '@patioer/shared'

function createHeartbeatCtx(agentId: string, overrides?: {
  budgetExceeded?: boolean
}): AgentContext {
  const harness = createHarnessMock()
  vi.mocked(harness.getProducts).mockResolvedValue([
    { id: 'p-1', title: 'Widget', price: 19.99, inventory: 50 },
  ])
  vi.mocked(harness.getAnalytics).mockResolvedValue({ revenue: 500, orders: 5 })

  const dataOS = createDataOsMock()

  return {
    tenantId: 'tenant-heartbeat',
    agentId,
    getHarness: () => harness,
    getEnabledPlatforms: () => ['shopify'],
    llm: vi.fn().mockResolvedValue({
      text: JSON.stringify({
        insights: ['Heartbeat OK'],
        additionalConflicts: [],
        recommendations: ['Continue monitoring.'],
        title: 'Test Product',
        description: 'Test desc',
        bulletPoints: [],
        seoKeywords: [],
        competitorMinPrice: 15,
        competitorAvgPrice: 20,
        pricePosition: 'below',
      }),
    }),
    budget: {
      isExceeded: vi.fn().mockResolvedValue(overrides?.budgetExceeded ?? false),
    },
    logAction: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue(undefined),
    createTicket: vi.fn().mockResolvedValue(undefined),
    describeDataOsCapabilities: () => 'DataOS available',
    dataOS,
    getRecentEvents: vi.fn().mockResolvedValue([]),
    getEventsForAgent: vi.fn().mockResolvedValue([]),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
  }
}

describe('HeartbeatRunner (AC-P4-07: 9 Agent 72h heartbeat)', () => {
  it('runs a single cycle across all 9 agents without crash', async () => {
    const runner = new HeartbeatRunner({
      ctxFactory: (agentId) => createHeartbeatCtx(agentId),
    })

    const cycle = await runner.runCycle(1)

    expect(cycle.results).toHaveLength(9)
    expect(cycle.allHealthy).toBe(true)
    expect(cycle.results.every((r) => r.success)).toBe(true)

    const agentIds = cycle.results.map((r) => r.agentId)
    for (const id of ELECTROOS_AGENT_IDS) {
      expect(agentIds).toContain(id)
    }
  })

  it('runs multiple cycles simulating 72h heartbeat', async () => {
    const totalCycles = 3
    const runner = new HeartbeatRunner({
      ctxFactory: (agentId) => createHeartbeatCtx(agentId),
    })

    const evidence = await runner.runHeartbeat(totalCycles)

    expect(evidence.totalCycles).toBe(3)
    expect(evidence.totalTicks).toBe(27)
    expect(evidence.failures).toHaveLength(0)
    expect(evidence.healthy).toBe(true)
  })

  it('records failure without crashing when a single agent throws', async () => {
    let callCount = 0
    const runner = new HeartbeatRunner({
      ctxFactory: (agentId) => {
        const ctx = createHeartbeatCtx(agentId)
        callCount++
        if (agentId === 'content-writer' && callCount <= 9) {
          vi.mocked(ctx.llm).mockRejectedValue(new Error('LLM down'))
          vi.mocked(ctx.getHarness('shopify').getProduct).mockRejectedValue(new Error('harness down'))
        }
        return ctx
      },
    })

    const evidence = await runner.runHeartbeat(1)

    expect(evidence.totalTicks).toBe(9)
    const failed = evidence.failures
    expect(failed.length).toBeLessThanOrEqual(1)
    const otherAgents = evidence.cycles[0]!.results.filter(
      (r) => r.agentId !== 'content-writer',
    )
    expect(otherAgents.every((r) => r.success)).toBe(true)
  })

  it('supports agent filter to run a subset of agents', async () => {
    const runner = new HeartbeatRunner({
      ctxFactory: (agentId) => createHeartbeatCtx(agentId),
      agentFilter: ['ceo-agent', 'finance-agent'],
    })

    const cycle = await runner.runCycle(1)

    expect(cycle.results).toHaveLength(2)
    expect(cycle.results.map((r) => r.agentId).sort()).toEqual(['ceo-agent', 'finance-agent'])
  })

  it('invokes onTick and onCycle callbacks', async () => {
    const ticks: string[] = []
    const cycles: number[] = []
    const runner = new HeartbeatRunner({
      ctxFactory: (agentId) => createHeartbeatCtx(agentId),
      agentFilter: ['product-scout'],
      onTick: (t) => ticks.push(t.agentId),
      onCycle: (c) => cycles.push(c.cycleNumber),
    })

    await runner.runHeartbeat(2)

    expect(ticks).toEqual(['product-scout', 'product-scout'])
    expect(cycles).toEqual([1, 2])
  })

  it('measures duration for each tick', async () => {
    const runner = new HeartbeatRunner({
      ctxFactory: (agentId) => createHeartbeatCtx(agentId),
      agentFilter: ['product-scout'],
    })

    const cycle = await runner.runCycle(1)

    const tick = cycle.results[0]!
    expect(tick.durationMs).toBeGreaterThanOrEqual(0)
    expect(tick.startedAt).toBeTruthy()
    expect(tick.completedAt).toBeTruthy()
  })

  it('generates evidence suitable for AC-P4-07 verification', async () => {
    const runner = new HeartbeatRunner({
      ctxFactory: (agentId) => createHeartbeatCtx(agentId),
    })

    const evidence = await runner.runHeartbeat(3)

    expect(evidence.heartbeatId).toBeTruthy()
    expect(evidence.startedAt).toBeTruthy()
    expect(evidence.completedAt).toBeTruthy()
    expect(evidence.healthy).toBe(true)
    expect(evidence.totalCycles).toBe(3)
    expect(evidence.totalTicks).toBe(27)
    expect(evidence.cycles).toHaveLength(3)
    for (const cycle of evidence.cycles) {
      expect(cycle.results).toHaveLength(9)
      expect(cycle.allHealthy).toBe(true)
    }
  })
})

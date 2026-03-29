/**
 * Sprint 14 · Task 14.4 / 14.5 — Disaster Recovery Tests
 *
 * AC-P4-20: Stop DataOS → ElectroOS agents run in degraded mode
 * AC-P4-21: Stop DevOS → ElectroOS agents run normally (no dependency)
 *
 * These tests validate that ElectroOS heartbeat cycles complete successfully
 * under two failure scenarios, proving three-layer isolation.
 */

import { describe, it, expect, vi } from 'vitest'
import { HeartbeatRunner } from '../packages/agent-runtime/src/heartbeat-runner.js'
import type { AgentContext } from '../packages/agent-runtime/src/context.js'
import type { TenantHarness } from '../packages/harness/src/base.harness.js'

function createHarnessMock(): TenantHarness {
  return {
    tenantId: 'tenant-dr',
    platformId: 'shopify',
    getProduct: vi.fn().mockResolvedValue(null),
    getProductsPage: vi.fn().mockResolvedValue({ items: [] }),
    getProducts: vi.fn().mockResolvedValue([
      { id: 'p-1', title: 'Widget', price: 19.99, inventory: 50 },
    ]),
    updatePrice: vi.fn().mockResolvedValue(undefined),
    updateInventory: vi.fn().mockResolvedValue(undefined),
    getOrdersPage: vi.fn().mockResolvedValue({ items: [] }),
    getOrders: vi.fn().mockResolvedValue([]),
    replyToMessage: vi.fn().mockResolvedValue(undefined),
    getOpenThreads: vi.fn().mockResolvedValue([]),
    getAnalytics: vi.fn().mockResolvedValue({ revenue: 1000, orders: 50 }),
  }
}

function llmMock() {
  return vi.fn().mockResolvedValue({
    text: JSON.stringify({
      insights: ['DR probe OK'],
      additionalConflicts: [],
      recommendations: ['Stay vigilant.'],
      title: 'DR Product',
      description: 'DR desc',
      bulletPoints: [],
      seoKeywords: [],
      competitorMinPrice: 15,
      competitorAvgPrice: 20,
      pricePosition: 'below',
    }),
  })
}

function createDRContext(
  agentId: string,
  scenario: 'dataos-down' | 'devos-down' | 'all-healthy',
): AgentContext {
  const harness = createHarnessMock()
  const ctx: AgentContext = {
    tenantId: 'tenant-dr',
    agentId,
    getHarness: () => harness,
    getEnabledPlatforms: () => ['shopify'],
    llm: llmMock(),
    budget: { isExceeded: vi.fn().mockResolvedValue(false) },
    logAction: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue(undefined),
    createTicket: vi.fn().mockResolvedValue(undefined),
    describeDataOsCapabilities: () =>
      scenario === 'dataos-down'
        ? 'DataOS is not available. You are operating in degraded (memoryless) mode.'
        : 'DataOS learning layer is available (Event Lake, Feature Store, Decision Memory).',
    dataOS: scenario === 'dataos-down' ? undefined : {
      recordEvent: vi.fn().mockResolvedValue(undefined),
      queryFeatures: vi.fn().mockResolvedValue([]),
      recordDecision: vi.fn().mockResolvedValue(undefined),
      queryDecisions: vi.fn().mockResolvedValue([]),
    },
  } as unknown as AgentContext

  return ctx
}

// ─── AC-P4-20: DataOS Down → ElectroOS Degraded ──────────────────────────────

describe('AC-P4-20: DataOS disaster recovery — ElectroOS degraded mode', () => {
  it('all 9 agents complete heartbeat cycle when DataOS is unavailable', async () => {
    const runner = new HeartbeatRunner({
      ctxFactory: (agentId) => createDRContext(agentId, 'dataos-down'),
    })

    const cycle = await runner.runCycle(1)

    expect(cycle.results).toHaveLength(9)
    expect(cycle.allHealthy).toBe(true)
    for (const tick of cycle.results) {
      expect(tick.success).toBe(true)
      expect(tick.error).toBeUndefined()
    }
  })

  it('describeDataOsCapabilities returns degraded message', () => {
    const ctx = createDRContext('product-scout', 'dataos-down')
    expect(ctx.describeDataOsCapabilities()).toContain('not available')
    expect(ctx.dataOS).toBeUndefined()
  })

  it('multi-cycle heartbeat stays healthy under DataOS outage', async () => {
    const runner = new HeartbeatRunner({
      ctxFactory: (agentId) => createDRContext(agentId, 'dataos-down'),
    })

    const evidence = await runner.runHeartbeat(5)

    expect(evidence.totalCycles).toBe(5)
    expect(evidence.totalTicks).toBe(45) // 5 × 9
    expect(evidence.failures).toHaveLength(0)
    expect(evidence.healthy).toBe(true)
  })

  it('50 tenants survive DataOS outage simultaneously', async () => {
    const promises = Array.from({ length: 50 }, (_, i) => {
      const tenantRunner = new HeartbeatRunner({
        ctxFactory: (agentId) => {
          const ctx = createDRContext(agentId, 'dataos-down')
          ;(ctx as unknown as Record<string, string>).tenantId = `tenant-dr-${i}`
          return ctx
        },
      })
      return tenantRunner.runCycle(1)
    })

    const results = await Promise.all(promises)

    expect(results).toHaveLength(50)
    for (const cycle of results) {
      expect(cycle.allHealthy).toBe(true)
    }
  })
})

// ─── AC-P4-21: DevOS Down → ElectroOS Normal ─────────────────────────────────

describe('AC-P4-21: DevOS disaster recovery — ElectroOS unaffected', () => {
  it('all 9 agents complete heartbeat cycle when DevOS is stopped', async () => {
    const runner = new HeartbeatRunner({
      ctxFactory: (agentId) => createDRContext(agentId, 'devos-down'),
    })

    const cycle = await runner.runCycle(1)

    expect(cycle.results).toHaveLength(9)
    expect(cycle.allHealthy).toBe(true)
    for (const tick of cycle.results) {
      expect(tick.success).toBe(true)
    }
  })

  it('DevOS absence does not affect ElectroOS DataOS capabilities', () => {
    const ctx = createDRContext('product-scout', 'devos-down')
    expect(ctx.describeDataOsCapabilities()).toContain('available')
    expect(ctx.dataOS).toBeDefined()
  })

  it('multi-cycle heartbeat is fully healthy when DevOS is stopped', async () => {
    const runner = new HeartbeatRunner({
      ctxFactory: (agentId) => createDRContext(agentId, 'devos-down'),
    })

    const evidence = await runner.runHeartbeat(5)

    expect(evidence.totalCycles).toBe(5)
    expect(evidence.totalTicks).toBe(45)
    expect(evidence.failures).toHaveLength(0)
    expect(evidence.healthy).toBe(true)
  })

  it('50 tenants unaffected by DevOS outage simultaneously', async () => {
    const promises = Array.from({ length: 50 }, (_, i) => {
      const tenantRunner = new HeartbeatRunner({
        ctxFactory: (agentId) => {
          const ctx = createDRContext(agentId, 'devos-down')
          ;(ctx as unknown as Record<string, string>).tenantId = `tenant-devos-dr-${i}`
          return ctx
        },
      })
      return tenantRunner.runCycle(1)
    })

    const results = await Promise.all(promises)

    expect(results).toHaveLength(50)
    for (const cycle of results) {
      expect(cycle.allHealthy).toBe(true)
    }
  })
})

// ─── Baseline: All-Healthy comparison ─────────────────────────────────────────

describe('Baseline: All layers healthy', () => {
  it('all 9 agents complete heartbeat when all systems are up', async () => {
    const runner = new HeartbeatRunner({
      ctxFactory: (agentId) => createDRContext(agentId, 'all-healthy'),
    })

    const cycle = await runner.runCycle(1)

    expect(cycle.results).toHaveLength(9)
    expect(cycle.allHealthy).toBe(true)
  })
})

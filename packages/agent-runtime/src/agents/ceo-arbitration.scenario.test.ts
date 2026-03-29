import { describe, expect, it, vi } from 'vitest'
import type { AgentContext } from '../context.js'
import type { RecentAgentEvent } from '../types.js'
import { runCeoAgent } from './ceo-agent.agent.js'
import { createDataOsMock, createHarnessMock } from './test-helpers.js'
import { ELECTROOS_AGENT_IDS } from '@patioer/shared'
import { validateSeedCompleteness, ELECTROOS_FULL_SEED, ELECTROOS_MONTHLY_BUDGET_USD } from '../electroos-seed.js'

function buildScenarioEvents(): Map<string, RecentAgentEvent[]> {
  const now = new Date().toISOString()
  const events = new Map<string, RecentAgentEvent[]>()

  events.set('ads-optimizer', [
    { id: 'ads-1', action: 'ads_optimizer.run.completed', payload: { synced: 5 }, createdAt: now },
    { id: 'ads-2', action: 'ads_optimizer.replenish_approval_requested', payload: { platform: 'shopify', dailyBudget: 800, campaignId: 'camp-1' }, createdAt: now },
    { id: 'ads-3', action: 'ads_optimizer.budget_increase_applied', payload: { platform: 'shopify', dailyBudget: 600, campaignId: 'camp-2' }, createdAt: now },
  ])

  events.set('inventory-guard', [
    { id: 'inv-1', action: 'inventory_guard.run.completed', payload: { synced: 20 }, createdAt: now },
    { id: 'inv-2', action: 'inventory_guard.low_stock_alert', payload: { sku: 'SKU-001', quantity: 2, platform: 'shopify' }, createdAt: now },
    { id: 'inv-3', action: 'inventory_guard.restock_approval_requested', payload: { sku: 'SKU-001', targetQuantity: 100 }, createdAt: now },
    { id: 'inv-4', action: 'inventory_guard.out_of_stock_detected', payload: { sku: 'SKU-002', quantity: 0, platform: 'shopify' }, createdAt: now },
  ])

  events.set('price-sentinel', [
    { id: 'ps-1', action: 'price_sentinel.run.completed', payload: { decisions: 3 }, createdAt: now },
    { id: 'ps-2', action: 'price_sentinel.approval_requested', payload: { productId: 'p-1', proposedPrice: 29.99, deltaPercent: 20 }, createdAt: now },
  ])

  for (const agentId of ELECTROOS_AGENT_IDS) {
    if (!events.has(agentId)) {
      events.set(agentId, [
        { id: `${agentId}-default`, action: `${agentId}.run.completed`, payload: {}, createdAt: now },
      ])
    }
  }

  return events
}

function createScenarioCtx(scenarioEvents: Map<string, RecentAgentEvent[]>, llmText?: string): AgentContext {
  const harness = createHarnessMock()
  const dataOS = createDataOsMock()

  return {
    tenantId: 'tenant-scenario',
    agentId: 'ceo-agent',
    getHarness: (_platform?: string) => harness,
    getEnabledPlatforms: () => ['shopify'],
    llm: vi.fn().mockResolvedValue({
      text: llmText ?? JSON.stringify({
        additionalConflicts: [],
        recommendations: [
          'Pause ad campaigns for out-of-stock SKUs immediately.',
          'Prioritize inventory replenishment before next ad cycle.',
        ],
      }),
    }),
    budget: { isExceeded: vi.fn().mockResolvedValue(false) },
    logAction: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue(undefined),
    createTicket: vi.fn().mockResolvedValue(undefined),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    getRecentEvents: vi.fn().mockResolvedValue([]),
    describeDataOsCapabilities: () => 'DataOS available',
    dataOS,
    getEventsForAgent: vi.fn().mockImplementation((agentId: string, _limit: number) => {
      return Promise.resolve(scenarioEvents.get(agentId) ?? [])
    }),
  }
}

describe('CEO Arbitration Scenario: Ads vs Inventory Conflict (AC-P4-10)', () => {
  it('detects Ads Optimizer increasing spend while Inventory Guard reports low stock', async () => {
    const events = buildScenarioEvents()
    const ctx = createScenarioCtx(events)

    const result = await runCeoAgent(ctx, {})

    expect(result.conflictsFound).toBeGreaterThanOrEqual(1)
    const adsVsInv = result.report!.conflicts.find(
      (c) => c.conflictType === 'inventory_vs_ads',
    )
    expect(adsVsInv).toBeDefined()
    expect(adsVsInv!.agentA).toBe('ads-optimizer')
    expect(adsVsInv!.agentB).toBe('inventory-guard')
    expect(adsVsInv!.resolution).toBeTruthy()
  })

  it('creates a coordination ticket for the Ads vs Inventory conflict', async () => {
    const events = buildScenarioEvents()
    const ctx = createScenarioCtx(events)

    const result = await runCeoAgent(ctx, {})

    expect(result.ticketsCreated).toBeGreaterThanOrEqual(1)
    expect(ctx.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('inventory_vs_ads'),
      }),
    )
  })

  it('does NOT detect conflict when ads and inventory are normal', async () => {
    const events = new Map<string, RecentAgentEvent[]>()
    const now = new Date().toISOString()
    for (const agentId of ELECTROOS_AGENT_IDS) {
      events.set(agentId, [
        { id: `${agentId}-ok`, action: `${agentId}.run.completed`, payload: {}, createdAt: now },
      ])
    }
    const ctx = createScenarioCtx(events)

    const result = await runCeoAgent(ctx, {})

    const adsVsInv = result.report!.conflicts.find(
      (c) => c.conflictType === 'inventory_vs_ads',
    )
    expect(adsVsInv).toBeUndefined()
  })

  it('includes LLM-generated recommendations in coordination report', async () => {
    const events = buildScenarioEvents()
    const ctx = createScenarioCtx(events)

    const result = await runCeoAgent(ctx, {})

    expect(result.report!.recommendations.length).toBeGreaterThan(0)
    expect(result.report!.recommendations.some((r) => r.includes('ad'))).toBe(true)
  })

  it('reports accurate agent status summaries', async () => {
    const events = buildScenarioEvents()
    const ctx = createScenarioCtx(events)

    const result = await runCeoAgent(ctx, {})

    expect(result.agentsChecked).toBe(9)
    const adsStatus = result.report!.agentStatuses.find((s) => s.agentId === 'ads-optimizer')
    expect(adsStatus).toBeDefined()
    expect(adsStatus!.recentEventCount).toBe(3)

    const invStatus = result.report!.agentStatuses.find((s) => s.agentId === 'inventory-guard')
    expect(invStatus).toBeDefined()
    expect(invStatus!.recentEventCount).toBe(4)
  })

  it('LLM receives conflict context in the prompt', async () => {
    const events = buildScenarioEvents()
    const ctx = createScenarioCtx(events)

    await runCeoAgent(ctx, {})

    const llmCall = vi.mocked(ctx.llm).mock.calls[0]
    expect(llmCall).toBeDefined()
    const prompt = llmCall![0].prompt
    expect(prompt).toContain('ads-optimizer')
    expect(prompt).toContain('inventory-guard')
    expect(prompt).toContain('inventory_vs_ads')
  })
})

describe('ElectroOS 9-Agent Seed Completeness', () => {
  it('covers all 9 ELECTROOS_AGENT_IDS', () => {
    const { valid, missing } = validateSeedCompleteness()
    expect(valid).toBe(true)
    expect(missing).toEqual([])
  })

  it('has exactly 9 agents in the seed', () => {
    expect(ELECTROOS_FULL_SEED).toHaveLength(9)
  })

  it('every agent has a positive monthly budget', () => {
    for (const agent of ELECTROOS_FULL_SEED) {
      expect(agent.monthlyBudgetUsd).toBeGreaterThan(0)
    }
  })

  it('total budget matches $430/tenant (Phase 4 plan)', () => {
    expect(ELECTROOS_MONTHLY_BUDGET_USD).toBe(430)
  })

  it('CEO Agent uses claude-opus-4-6 model (Phase 4 Agent Schedule)', () => {
    const ceo = ELECTROOS_FULL_SEED.find((a) => a.id === 'ceo-agent')
    expect(ceo).toBeDefined()
    expect(ceo!.model).toBe('claude-opus-4-6')
  })

  it('Finance Agent triggers monthly on the 1st', () => {
    const finance = ELECTROOS_FULL_SEED.find((a) => a.id === 'finance-agent')
    expect(finance).toBeDefined()
    expect(finance!.trigger).toBe('monthly')
    expect(finance!.schedule).toContain('1 * *')
  })

  it('every agent ID in the seed is a valid ElectroOsAgentId', () => {
    const validIds = new Set(ELECTROOS_AGENT_IDS)
    for (const agent of ELECTROOS_FULL_SEED) {
      expect(validIds.has(agent.id)).toBe(true)
    }
  })
})

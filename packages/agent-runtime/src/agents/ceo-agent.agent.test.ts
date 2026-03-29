import { describe, expect, it, vi } from 'vitest'
import type { AgentContext } from '../context.js'
import type { DataOsPort, RecentAgentEvent } from '../types.js'
import { runCeoAgent } from './ceo-agent.agent.js'
import { createDataOsMock, createHarnessMock } from './test-helpers.js'

const VALID_LLM_JSON = JSON.stringify({
  additionalConflicts: [],
  recommendations: [
    'All agents operating normally. Continue monitoring.',
    'Consider increasing Market Intel frequency to weekly from bi-weekly.',
  ],
})

const CONFLICT_LLM_JSON = JSON.stringify({
  additionalConflicts: [
    {
      agentA: 'price-sentinel',
      agentB: 'content-writer',
      conflictType: 'price_conflict',
      description: 'Price changes not reflected in product descriptions',
      resolution: 'Trigger content refresh after price updates',
    },
  ],
  recommendations: ['Synchronize price and content update cycles.'],
})

function makeEvents(overrides?: {
  withAdsApproval?: boolean
  withLowStock?: boolean
  withErrors?: string[]
}): (agentId: string) => RecentAgentEvent[] {
  return (agentId: string): RecentAgentEvent[] => {
    const base: RecentAgentEvent[] = [
      { id: `${agentId}-1`, action: `${agentId}.run.completed`, payload: {}, createdAt: new Date().toISOString() },
    ]

    if (overrides?.withAdsApproval && agentId === 'ads-optimizer') {
      base.push({
        id: 'ads-budget-1',
        action: 'ads_optimizer.replenish_approval_requested',
        payload: { dailyBudget: 500 },
        createdAt: new Date().toISOString(),
      })
    }

    if (overrides?.withLowStock && agentId === 'inventory-guard') {
      base.push({
        id: 'inv-low-1',
        action: 'inventory_guard.low_stock_alert',
        payload: { sku: 'SKU-001', quantity: 2 },
        createdAt: new Date().toISOString(),
      })
    }

    if (overrides?.withErrors?.includes(agentId)) {
      base.push({
        id: `${agentId}-err`,
        action: `${agentId}.harness_error`,
        payload: { code: '500' },
        createdAt: new Date().toISOString(),
      })
    }

    return base
  }
}

function createCtx(overrides?: {
  budgetExceeded?: boolean
  llmText?: string
  withDataOS?: boolean
  eventFactory?: (agentId: string) => RecentAgentEvent[]
  enforceDailyWindow?: boolean
}): { ctx: AgentContext; dataOS: DataOsPort } {
  const harness = createHarnessMock()
  const dataOS = createDataOsMock()
  const evFactory = overrides?.eventFactory ?? makeEvents()

  const ctx: AgentContext = {
    tenantId: 'tenant-a',
    agentId: 'agent-ceo',
    getHarness: (_platform?: string) => harness,
    getEnabledPlatforms: () => ['shopify'],
    llm: vi.fn().mockResolvedValue({ text: overrides?.llmText ?? VALID_LLM_JSON }),
    budget: {
      isExceeded: vi.fn().mockResolvedValue(overrides?.budgetExceeded ?? false),
    },
    logAction: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue(undefined),
    createTicket: vi.fn().mockResolvedValue(undefined),
    describeDataOsCapabilities: () => 'DataOS available',
    dataOS: overrides?.withDataOS !== false ? dataOS : undefined,
    getEventsForAgent: vi.fn().mockImplementation((agentId: string, _limit: number) => {
      return Promise.resolve(evFactory(agentId))
    }),
  }
  return { ctx, dataOS }
}

describe('runCeoAgent', () => {
  it('generates a coordination report checking all 9 agents', async () => {
    const { ctx } = createCtx()

    const result = await runCeoAgent(ctx, {})

    expect(result.runId).toBeTruthy()
    expect(result.agentsChecked).toBe(9)
    expect(result.report).not.toBeNull()
    expect(result.report!.agentStatuses).toHaveLength(9)
    expect(result.report!.recommendations.length).toBeGreaterThan(0)
  })

  it('returns null report when budget is exceeded', async () => {
    const { ctx } = createCtx({ budgetExceeded: true })

    const result = await runCeoAgent(ctx, {})

    expect(result.report).toBeNull()
    expect(result.agentsChecked).toBe(0)
    expect(ctx.llm).not.toHaveBeenCalled()
    expect(ctx.logAction).toHaveBeenCalledWith('ceo_agent.budget_exceeded', expect.any(Object))
  })

  it('detects Ads vs Inventory conflict (AC-P4-10)', async () => {
    const { ctx } = createCtx({
      eventFactory: makeEvents({ withAdsApproval: true, withLowStock: true }),
    })

    const result = await runCeoAgent(ctx, {})

    expect(result.conflictsFound).toBeGreaterThanOrEqual(1)
    const adsVsInv = result.report!.conflicts.find(
      (c) => c.conflictType === 'inventory_vs_ads',
    )
    expect(adsVsInv).toBeDefined()
    expect(adsVsInv!.agentA).toBe('ads-optimizer')
    expect(adsVsInv!.agentB).toBe('inventory-guard')
  })

  it('creates coordination tickets for detected conflicts', async () => {
    const { ctx } = createCtx({
      eventFactory: makeEvents({ withAdsApproval: true, withLowStock: true }),
    })

    const result = await runCeoAgent(ctx, {})

    expect(result.ticketsCreated).toBeGreaterThanOrEqual(1)
    expect(ctx.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('[Coordination] inventory_vs_ads'),
        body: expect.stringContaining('Ads Optimizer is increasing ad spend'),
      }),
    )
  })

  it('includes LLM-detected conflicts in the report', async () => {
    const { ctx } = createCtx({ llmText: CONFLICT_LLM_JSON })

    const result = await runCeoAgent(ctx, {})

    expect(result.conflictsFound).toBe(1)
    const priceConflict = result.report!.conflicts.find(
      (c) => c.conflictType === 'price_conflict',
    )
    expect(priceConflict).toBeDefined()
    expect(priceConflict!.agentA).toBe('price-sentinel')
  })

  it('handles LLM failure gracefully', async () => {
    const { ctx } = createCtx()
    vi.mocked(ctx.llm).mockRejectedValue(new Error('LLM timeout'))

    const result = await runCeoAgent(ctx, {})

    expect(result.report).not.toBeNull()
    expect(result.report!.recommendations).toHaveLength(1)
    expect(result.report!.recommendations[0]).toContain('LLM analysis unavailable')
    expect(ctx.logAction).toHaveBeenCalledWith(
      'ceo_agent.llm_failed',
      expect.objectContaining({ runId: expect.any(String) }),
    )
  })

  it('operates without DataOS (degraded mode)', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: false })

    const result = await runCeoAgent(ctx, {})

    expect(result.report).not.toBeNull()
    expect(result.agentsChecked).toBe(9)
    expect(dataOS.recordMemory).not.toHaveBeenCalled()
    expect(dataOS.recordLakeEvent).not.toHaveBeenCalled()
  })

  it('records report to Decision Memory and Event Lake', async () => {
    const { ctx, dataOS } = createCtx()

    await runCeoAgent(ctx, {})

    expect(dataOS.recordMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'ceo-agent',
        entityId: expect.stringContaining('coordination-'),
      }),
    )
    expect(dataOS.recordLakeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'coordination_report_generated',
        metadata: expect.objectContaining({ agentType: 'ceo-agent' }),
      }),
    )
  })

  it('handles ticket creation failure gracefully', async () => {
    const { ctx } = createCtx({
      eventFactory: makeEvents({ withAdsApproval: true, withLowStock: true }),
    })
    vi.mocked(ctx.createTicket).mockRejectedValue(new Error('ticket service down'))

    const result = await runCeoAgent(ctx, {})

    expect(result.ticketsCreated).toBe(0)
    expect(ctx.logAction).toHaveBeenCalledWith(
      'ceo_agent.ticket_create_failed',
      expect.objectContaining({ conflict: 'inventory_vs_ads' }),
    )
  })

  it('detects resource overlap when 3+ agents have errors', async () => {
    const { ctx } = createCtx({
      eventFactory: makeEvents({
        withErrors: ['product-scout', 'price-sentinel', 'support-relay'],
      }),
    })

    const result = await runCeoAgent(ctx, {})

    const overlap = result.report!.conflicts.find(
      (c) => c.conflictType === 'resource_overlap',
    )
    expect(overlap).toBeDefined()
    expect(overlap!.description).toContain('Multiple agents experiencing errors')
  })

  it('logs started and completed actions', async () => {
    const { ctx } = createCtx()

    await runCeoAgent(ctx, {})

    expect(ctx.logAction).toHaveBeenCalledWith(
      'ceo_agent.run.started',
      expect.objectContaining({ runId: expect.any(String) }),
    )
    expect(ctx.logAction).toHaveBeenCalledWith(
      'ceo_agent.run.completed',
      expect.objectContaining({ agentsChecked: 9 }),
    )
  })

  it('handles getEventsForAgent failure for individual agents gracefully', async () => {
    const { ctx } = createCtx()
    let callCount = 0
    vi.mocked(ctx.getEventsForAgent!).mockImplementation(async () => {
      callCount++
      if (callCount === 3) throw new Error('events service timeout')
      return [{ id: 'e-1', action: 'test.completed', payload: {}, createdAt: new Date().toISOString() }]
    })

    const result = await runCeoAgent(ctx, {})

    expect(result.agentsChecked).toBe(9)
    expect(ctx.logAction).toHaveBeenCalledWith(
      'ceo_agent.events_fetch_failed',
      expect.objectContaining({ error: 'events service timeout' }),
    )
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { AgentContext } from '../context.js'
import { DEFAULT_GOVERNANCE_SETTINGS } from '../ports.js'
import type { DataOsPort, LakeEventRow } from '../types.js'
import { runFinanceAgent } from './finance-agent.agent.js'
import { createDataOsMock, createHarnessMock } from './test-helpers.js'

const VALID_LLM_JSON = JSON.stringify({
  insights: [
    'Revenue grew 12% month-over-month',
    'Ad spend ROAS improved to 4.2x',
    'Consider reducing returns via better product descriptions',
  ],
})

const SAMPLE_LAKE_EVENTS: LakeEventRow[] = [
  { agentId: 'product-scout', eventType: 'order_completed', payload: { platform: 'shopify', revenue: 150, currency: 'USD' }, createdAt: '2026-03-05T10:00:00Z' },
  { agentId: 'product-scout', eventType: 'order_completed', payload: { platform: 'shopify', revenue: 200, currency: 'USD' }, createdAt: '2026-03-10T10:00:00Z' },
  { agentId: 'ads-optimizer', eventType: 'ads_budget_applied', payload: { platform: 'shopify', dailyBudget: 50, currency: 'USD' }, createdAt: '2026-03-06T10:00:00Z' },
  { agentId: 'support-relay', eventType: 'return_processed', payload: { platform: 'shopify', amount: 30, currency: 'USD' }, createdAt: '2026-03-08T10:00:00Z' },
  { agentId: 'content-writer', eventType: 'content_generated', payload: { productId: 'p-1' }, createdAt: '2026-03-09T10:00:00Z' },
]

function createCtx(overrides?: {
  budgetExceeded?: boolean
  llmText?: string
  withDataOS?: boolean
  lakeEvents?: LakeEventRow[]
  analyticsRevenue?: number
  analyticsOrders?: number
  harnessError?: boolean
}): { ctx: AgentContext; dataOS: DataOsPort } {
  const harness = createHarnessMock()
  vi.mocked(harness.getAnalytics).mockResolvedValue({
    revenue: overrides?.analyticsRevenue ?? 1000,
    orders: overrides?.analyticsOrders ?? 10,
  })
  if (overrides?.harnessError) {
    vi.mocked(harness.getAnalytics).mockRejectedValue(new Error('harness timeout'))
  }

  const dataOS = createDataOsMock()
  const queryLakeEvents = vi.fn().mockResolvedValue(overrides?.lakeEvents ?? SAMPLE_LAKE_EVENTS)
  ;(dataOS as DataOsPort & { queryLakeEvents: typeof queryLakeEvents }).queryLakeEvents = queryLakeEvents

  const ctx: AgentContext = {
    tenantId: 'tenant-a',
    agentId: 'agent-finance',
    getHarness: (_platform?: string) => harness,
    getEnabledPlatforms: () => ['shopify'],
    llm: vi.fn().mockResolvedValue({ text: overrides?.llmText ?? VALID_LLM_JSON }),
    budget: {
      isExceeded: vi.fn().mockResolvedValue(overrides?.budgetExceeded ?? false),
    },
    logAction: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue(undefined),
    createTicket: vi.fn().mockResolvedValue(undefined),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    getRecentEvents: vi.fn().mockResolvedValue([]),
    getEventsForAgent: vi.fn().mockResolvedValue([]),
    describeDataOsCapabilities: () => 'DataOS available',
    dataOS: overrides?.withDataOS !== false ? dataOS : undefined,
    getGovernanceSettings: vi.fn().mockResolvedValue({ ...DEFAULT_GOVERNANCE_SETTINGS }),
    getEffectiveGovernance: vi.fn().mockResolvedValue({ ...DEFAULT_GOVERNANCE_SETTINGS }),
    isHumanInLoop: vi.fn().mockResolvedValue(false),
    getActiveSop: vi.fn().mockResolvedValue(null),
  }
  return { ctx, dataOS }
}

describe('runFinanceAgent', () => {
  it('generates a P&L report from Event Lake data', async () => {
    const { ctx } = createCtx()

    const result = await runFinanceAgent(ctx, { month: 3, year: 2026 })

    expect(result.runId).toBeTruthy()
    expect(result.report).not.toBeNull()
    expect(result.report!.month).toBe(3)
    expect(result.report!.year).toBe(2026)
    expect(result.report!.totalRevenue).toBe(350)
    expect(result.report!.totalAdsSpend).toBe(50)
    expect(result.report!.totalReturns).toBe(30)
    expect(result.report!.grossProfit).toBe(270)
    expect(result.report!.insights).toHaveLength(3)
    expect(result.eventsFetched).toBe(5)
  })

  it('returns null report when budget is exceeded', async () => {
    const { ctx } = createCtx({ budgetExceeded: true })

    const result = await runFinanceAgent(ctx, { month: 3, year: 2026 })

    expect(result.report).toBeNull()
    expect(ctx.llm).not.toHaveBeenCalled()
    expect(ctx.logAction).toHaveBeenCalledWith('finance_agent.budget_exceeded', expect.any(Object))
  })

  it('falls back to harness analytics when no lake revenue events exist', async () => {
    const { ctx } = createCtx({
      lakeEvents: [],
      analyticsRevenue: 5000,
      analyticsOrders: 50,
    })

    const result = await runFinanceAgent(ctx, { month: 3, year: 2026 })

    expect(result.report).not.toBeNull()
    expect(result.report!.totalRevenue).toBe(5000)
  })

  it('uses input.platforms when provided', async () => {
    const { ctx } = createCtx()

    const result = await runFinanceAgent(ctx, { month: 3, year: 2026, platforms: ['amazon'] })

    expect(result.platforms).toEqual(['amazon'])
  })

  it('handles harness analytics failure gracefully', async () => {
    const { ctx } = createCtx({ harnessError: true })

    const result = await runFinanceAgent(ctx, { month: 3, year: 2026 })

    expect(result.report).not.toBeNull()
    expect(ctx.logAction).toHaveBeenCalledWith(
      'finance_agent.harness_degraded',
      expect.objectContaining({ platform: 'shopify' }),
    )
  })

  it('operates in degraded mode when DataOS is unavailable', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: false, analyticsRevenue: 2000 })

    const result = await runFinanceAgent(ctx, { month: 3, year: 2026 })

    expect(result.report).not.toBeNull()
    expect(result.report!.totalRevenue).toBe(2000)
    expect(result.eventsFetched).toBe(0)
    expect(dataOS.recordMemory).not.toHaveBeenCalled()
    expect(dataOS.recordLakeEvent).not.toHaveBeenCalled()
  })

  it('records report to Decision Memory and Event Lake', async () => {
    const { ctx, dataOS } = createCtx()

    await runFinanceAgent(ctx, { month: 3, year: 2026 })

    expect(dataOS.recordMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'finance-agent',
        entityId: 'pnl-2026-03',
      }),
    )
    expect(dataOS.recordLakeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'pnl_report_generated',
        entityId: 'pnl-2026-03',
        metadata: expect.objectContaining({ agentType: 'finance-agent' }),
      }),
    )
  })

  it('handles LLM failure gracefully with fallback insight', async () => {
    const { ctx } = createCtx()
    vi.mocked(ctx.llm).mockRejectedValue(new Error('LLM timeout'))

    const result = await runFinanceAgent(ctx, { month: 3, year: 2026 })

    expect(result.report).not.toBeNull()
    expect(result.report!.insights).toHaveLength(1)
    expect(result.report!.insights[0]).toContain('LLM insights unavailable')
    expect(ctx.logAction).toHaveBeenCalledWith(
      'finance_agent.llm_failed',
      expect.objectContaining({ runId: expect.any(String) }),
    )
  })

  it('handles dataOS.queryLakeEvents failure gracefully', async () => {
    const { ctx, dataOS } = createCtx()
    vi.mocked(
      (dataOS as DataOsPort & { queryLakeEvents: ReturnType<typeof vi.fn> }).queryLakeEvents,
    ).mockRejectedValue(new Error('lake query timeout'))

    const result = await runFinanceAgent(ctx, { month: 3, year: 2026 })

    expect(result.report).not.toBeNull()
    expect(result.eventsFetched).toBe(0)
    expect(ctx.logAction).toHaveBeenCalledWith(
      'finance_agent.dataos_degraded',
      expect.objectContaining({ op: 'queryLakeEvents' }),
    )
  })

  it('handles dataOS.recordMemory failure gracefully', async () => {
    const { ctx, dataOS } = createCtx()
    vi.mocked(dataOS.recordMemory).mockRejectedValue(new Error('write failed'))

    const result = await runFinanceAgent(ctx, { month: 3, year: 2026 })

    expect(result.report).not.toBeNull()
    expect(ctx.logAction).toHaveBeenCalledWith(
      'finance_agent.dataos_write_failed',
      expect.objectContaining({ op: 'recordMemory' }),
    )
  })

  it('calculates correct gross margin percentage', async () => {
    const events: LakeEventRow[] = [
      { agentId: 'scout', eventType: 'order_completed', payload: { revenue: 1000, platform: 'shopify' }, createdAt: '2026-03-01T00:00:00Z' },
      { agentId: 'ads', eventType: 'ads_budget_applied', payload: { dailyBudget: 200, platform: 'shopify' }, createdAt: '2026-03-01T00:00:00Z' },
    ]
    const { ctx } = createCtx({ lakeEvents: events })

    const result = await runFinanceAgent(ctx, { month: 3, year: 2026 })

    expect(result.report!.totalRevenue).toBe(1000)
    expect(result.report!.totalAdsSpend).toBe(200)
    expect(result.report!.grossProfit).toBe(800)
    expect(result.report!.grossMarginPct).toBeCloseTo(80, 1)
  })

  it('ignores unrelated event types', async () => {
    const events: LakeEventRow[] = [
      { agentId: 'content-writer', eventType: 'content_generated', payload: { productId: 'p-1' }, createdAt: '2026-03-01T00:00:00Z' },
      { agentId: 'market-intel', eventType: 'market_intel_completed', payload: {}, createdAt: '2026-03-01T00:00:00Z' },
    ]
    const { ctx } = createCtx({ lakeEvents: events, analyticsRevenue: 0 })

    const result = await runFinanceAgent(ctx, { month: 3, year: 2026 })

    expect(result.report!.totalRevenue).toBe(0)
    expect(result.report!.totalAdsSpend).toBe(0)
    expect(result.report!.lineItems).toHaveLength(0)
  })

  it('logs started and completed actions', async () => {
    const { ctx } = createCtx()

    await runFinanceAgent(ctx, { month: 3, year: 2026 })

    expect(ctx.logAction).toHaveBeenCalledWith(
      'finance_agent.run.started',
      expect.objectContaining({ month: 3, year: 2026 }),
    )
    expect(ctx.logAction).toHaveBeenCalledWith(
      'finance_agent.run.completed',
      expect.objectContaining({ month: 3, year: 2026, totalRevenue: 350 }),
    )
  })
})

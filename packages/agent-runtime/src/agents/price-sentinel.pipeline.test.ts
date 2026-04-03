import { describe, expect, it, vi } from 'vitest'
import { HarnessError } from '@patioer/harness'
import type { TenantHarness } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import { DEFAULT_GOVERNANCE_SETTINGS } from '../ports.js'
import { runPipeline } from '../decision-pipeline.js'
import { NO_DEGRADATION } from '../decision-pipeline.js'
import { createHarnessMock, createDataOsMock } from './test-helpers.js'
import { priceSentinelPipeline } from './price-sentinel.pipeline.js'
import type { PriceProposal } from './price-sentinel.pipeline.js'

function createPipelineCtx(overrides?: {
  budgetExceeded?: boolean
  products?: Array<{ id: string; title: string; price: number | null; inventory: number | null }>
  llmResponse?: string
}): { ctx: AgentContext; harness: TenantHarness } {
  const products = overrides?.products ?? [
    { id: 'p-1', title: 'Widget A', price: 100, inventory: 50 },
    { id: 'p-2', title: 'Widget B', price: 200, inventory: 30 },
  ]

  const llmResponse = overrides?.llmResponse ?? JSON.stringify(
    products.map((p) => ({
      productId: p.id,
      action: 'adjust',
      proposedPrice: (p.price ?? 0) * 1.05,
      reason: `Competitive adjustment for ${p.id}`,
      confidence: 0.85,
      expectedMarginDelta: 2.5,
    })),
  )

  const harness = createHarnessMock()
  vi.mocked(harness.getProductsPage).mockResolvedValue({
    items: products.map((p) => ({ ...p, sku: p.id, currency: 'USD' })),
    nextCursor: undefined,
  })

  const ctx: AgentContext = {
    tenantId: 'tenant-a',
    agentId: 'price-sentinel-pipeline',
    getHarness: () => harness,
    getEnabledPlatforms: () => ['shopify'],
    llm: vi.fn().mockResolvedValue({ text: llmResponse }),
    budget: {
      isExceeded: vi.fn().mockResolvedValue(overrides?.budgetExceeded ?? false),
    },
    logAction: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue(undefined),
    createTicket: vi.fn().mockResolvedValue(undefined),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    getRecentEvents: vi.fn().mockResolvedValue([]),
    getEventsForAgent: vi.fn().mockResolvedValue([]),
    describeDataOsCapabilities: () => 'DataOS not available',
    getGovernanceSettings: vi.fn().mockResolvedValue({ ...DEFAULT_GOVERNANCE_SETTINGS }),
    getEffectiveGovernance: vi.fn().mockResolvedValue({ ...DEFAULT_GOVERNANCE_SETTINGS }),
    isHumanInLoop: vi.fn().mockResolvedValue(false),
    getActiveSop: vi.fn().mockResolvedValue(null),
  }

  return { ctx, harness }
}

describe('priceSentinelPipeline', () => {
  describe('gather', () => {
    it('fetches products from harness and returns decision context', async () => {
      const { ctx, harness } = createPipelineCtx()
      const context = await priceSentinelPipeline.gather(ctx, {})

      expect(harness.getProductsPage).toHaveBeenCalledWith({ limit: 50 })
      expect(context.governance).toEqual(DEFAULT_GOVERNANCE_SETTINGS)
      expect(context.degradation).toEqual(expect.objectContaining({
        profitDataMissing: true,
      }))
      const products = context.platformData.products as unknown[]
      expect(products).toHaveLength(2)
    })

    it('returns early with preflight reason when budget exceeded', async () => {
      const { ctx } = createPipelineCtx({ budgetExceeded: true })
      const context = await priceSentinelPipeline.gather(ctx, {})

      expect(context.platformData.preflight).toBe('budget_exceeded')
    })

    it('loads economics from business ports when available', async () => {
      const { ctx } = createPipelineCtx()
      const getSkuEconomics = vi.fn().mockResolvedValue({
        grossRevenue: 1000,
        contributionMargin: 300,
        unitsSold: 25,
        tacos: 0.1,
      })
      ctx.business = {
        unitEconomics: { getSkuEconomics, getDailyOverview: vi.fn().mockResolvedValue([]) },
        inventoryPlanning: { getInboundShipments: vi.fn(), getReplenishmentSuggestions: vi.fn() },
        accountHealth: { getHealthSummary: vi.fn().mockResolvedValue({ overallStatus: 'healthy' }), getListingIssues: vi.fn() },
        serviceOps: { getCases: vi.fn(), getRefundSummary: vi.fn() },
      }

      const context = await priceSentinelPipeline.gather(ctx, {})
      const products = context.platformData.products as Array<{ economics: unknown }>
      expect(products[0]?.economics).toEqual(expect.objectContaining({ grossRevenue30d: 1000 }))
    })
  })

  describe('reason', () => {
    it('calls LLM and parses proposals from response', async () => {
      const { ctx } = createPipelineCtx()
      const context = await priceSentinelPipeline.gather(ctx, {})
      const decisions = await priceSentinelPipeline.reason(ctx, context, {})

      expect(ctx.llm).toHaveBeenCalled()
      expect(decisions).toHaveLength(2)
      expect(decisions[0]?.action).toBe('adjust')
      expect(decisions[0]?.confidence).toBe(0.85)
    })

    it('returns empty array when no products gathered', async () => {
      const { ctx } = createPipelineCtx({ products: [] })
      const context = await priceSentinelPipeline.gather(ctx, {})
      const decisions = await priceSentinelPipeline.reason(ctx, context, {})
      expect(decisions).toEqual([])
    })

    it('returns empty when preflight blocks', async () => {
      const { ctx } = createPipelineCtx({ budgetExceeded: true })
      const context = await priceSentinelPipeline.gather(ctx, {})
      const decisions = await priceSentinelPipeline.reason(ctx, context, {})
      expect(decisions).toEqual([])
    })

    it('handles malformed LLM response gracefully', async () => {
      const { ctx } = createPipelineCtx({ llmResponse: 'not valid json' })
      const context = await priceSentinelPipeline.gather(ctx, {})
      const decisions = await priceSentinelPipeline.reason(ctx, context, {})
      expect(decisions).toEqual([])
    })

    it('filters out proposals referencing unknown productIds', async () => {
      const llmResponse = JSON.stringify([
        { productId: 'p-1', action: 'adjust', proposedPrice: 105, reason: 'ok', confidence: 0.8, expectedMarginDelta: 1 },
        { productId: 'unknown', action: 'adjust', proposedPrice: 50, reason: 'bad', confidence: 0.5, expectedMarginDelta: 0 },
      ])
      const { ctx } = createPipelineCtx({ llmResponse })
      const context = await priceSentinelPipeline.gather(ctx, {})
      const decisions = await priceSentinelPipeline.reason(ctx, context, {})
      expect(decisions).toHaveLength(1)
      expect(decisions[0]?.productId).toBe('p-1')
    })
  })

  describe('govern', () => {
    it('marks hold decisions as auto_execute', async () => {
      const { ctx } = createPipelineCtx()
      const context = await priceSentinelPipeline.gather(ctx, {})
      const holdDecision: PriceProposal = {
        productId: 'p-1', platform: 'shopify', currentPrice: 100, proposedPrice: 100,
        action: 'hold', reason: 'price is fine', confidence: 0.9, expectedMarginDelta: 0,
      }

      const governed = await priceSentinelPipeline.govern(ctx, [holdDecision], context)
      expect(governed[0]?.action).toBe('auto_execute')
    })

    it('requires approval when delta exceeds threshold', async () => {
      const { ctx } = createPipelineCtx()
      const context = await priceSentinelPipeline.gather(ctx, {})
      context.degradation = { ...NO_DEGRADATION }
      const bigMove: PriceProposal = {
        productId: 'p-1', platform: 'shopify', currentPrice: 100, proposedPrice: 130,
        action: 'adjust', reason: 'big increase', confidence: 0.7, expectedMarginDelta: 5,
      }

      const governed = await priceSentinelPipeline.govern(ctx, [bigMove], context)
      expect(governed[0]?.action).toBe('requires_approval')
      expect(governed[0]?.guard.constitutionTriggered).toBe(true)
    })

    it('auto-executes when delta is within threshold', async () => {
      const { ctx } = createPipelineCtx()
      const context = await priceSentinelPipeline.gather(ctx, {})
      context.degradation = { ...NO_DEGRADATION }
      const smallMove: PriceProposal = {
        productId: 'p-1', platform: 'shopify', currentPrice: 100, proposedPrice: 105,
        action: 'adjust', reason: 'small bump', confidence: 0.85, expectedMarginDelta: 2,
      }

      const governed = await priceSentinelPipeline.govern(ctx, [smallMove], context)
      expect(governed[0]?.action).toBe('auto_execute')
    })

    it('applies degradation overlay when profit data is missing', async () => {
      const { ctx } = createPipelineCtx()
      const context = await priceSentinelPipeline.gather(ctx, {})
      context.degradation = { ...NO_DEGRADATION, profitDataMissing: true }
      const decision: PriceProposal = {
        productId: 'p-1', platform: 'shopify', currentPrice: 100, proposedPrice: 105,
        action: 'adjust', reason: 'small', confidence: 0.8, expectedMarginDelta: 1,
      }

      const governed = await priceSentinelPipeline.govern(ctx, [decision], context)
      expect(governed[0]?.action).toBe('degraded_suggest_only')
      expect(governed[0]?.guard.degraded).toBe(true)
    })
  })

  describe('execute', () => {
    it('calls harness.updatePrice for auto_execute decisions', async () => {
      const { ctx, harness } = createPipelineCtx()
      const context = await priceSentinelPipeline.gather(ctx, {})
      const governed = [{
        decision: {
          productId: 'p-1', platform: 'shopify', currentPrice: 100, proposedPrice: 105,
          action: 'adjust' as const, reason: 'bump', confidence: 0.85, expectedMarginDelta: 2,
        },
        action: 'auto_execute' as const,
        reason: 'within threshold',
        confidence: 0.85,
        guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: false },
      }]

      const result = await priceSentinelPipeline.execute(ctx, governed, context)
      expect(harness.updatePrice).toHaveBeenCalledWith('p-1', 105)
      expect(result.executedCount).toBe(1)
    })

    it('sends approval for requires_approval decisions', async () => {
      const { ctx, harness } = createPipelineCtx()
      const context = await priceSentinelPipeline.gather(ctx, {})
      const governed = [{
        decision: {
          productId: 'p-1', platform: 'shopify', currentPrice: 100, proposedPrice: 130,
          action: 'adjust' as const, reason: 'big move', confidence: 0.7, expectedMarginDelta: 5,
        },
        action: 'requires_approval' as const,
        reason: 'exceeds threshold',
        confidence: 0.7,
        guard: { degraded: false, constitutionTriggered: true, businessGuardTriggered: false },
      }]

      const result = await priceSentinelPipeline.execute(ctx, governed, context)
      expect(harness.updatePrice).not.toHaveBeenCalled()
      expect(ctx.requestApproval).toHaveBeenCalledTimes(1)
      expect(result.approvalCount).toBe(1)
    })

    it('skips duplicate approvals', async () => {
      const { ctx } = createPipelineCtx()
      const context = await priceSentinelPipeline.gather(ctx, {})
      ;(context.platformData as Record<string, unknown>).pendingApprovals = [
        { action: 'price.update', payload: { productId: 'p-1', proposedPrice: 130 } },
      ]

      const governed = [{
        decision: {
          productId: 'p-1', platform: 'shopify', currentPrice: 100, proposedPrice: 130,
          action: 'adjust' as const, reason: 'big move', confidence: 0.7, expectedMarginDelta: 5,
        },
        action: 'requires_approval' as const,
        reason: 'exceeds threshold',
        confidence: 0.7,
        guard: { degraded: false, constitutionTriggered: true, businessGuardTriggered: false },
      }]

      const result = await priceSentinelPipeline.execute(ctx, governed, context)
      expect(ctx.requestApproval).not.toHaveBeenCalled()
      expect(result.approvalCount).toBe(0)
    })

    it('logs suggestion for degraded_suggest_only', async () => {
      const { ctx, harness } = createPipelineCtx()
      const context = await priceSentinelPipeline.gather(ctx, {})
      const governed = [{
        decision: {
          productId: 'p-1', platform: 'shopify', currentPrice: 100, proposedPrice: 105,
          action: 'adjust' as const, reason: 'suggestion', confidence: 0.8, expectedMarginDelta: 1,
        },
        action: 'degraded_suggest_only' as const,
        reason: 'profit data missing',
        confidence: 0.8,
        guard: { degraded: true, constitutionTriggered: false, businessGuardTriggered: false },
      }]

      const result = await priceSentinelPipeline.execute(ctx, governed, context)
      expect(harness.updatePrice).not.toHaveBeenCalled()
      expect(ctx.requestApproval).not.toHaveBeenCalled()
      expect(result.degradedCount).toBe(1)
      expect(ctx.logAction).toHaveBeenCalledWith('price_sentinel.suggestion', expect.objectContaining({
        productId: 'p-1',
      }))
    })

    it('blocks and logs for blocked decisions', async () => {
      const { ctx, harness } = createPipelineCtx()
      const context = await priceSentinelPipeline.gather(ctx, {})
      const governed = [{
        decision: {
          productId: 'p-1', platform: 'shopify', currentPrice: 100, proposedPrice: 105,
          action: 'adjust' as const, reason: 'blocked', confidence: 0.5, expectedMarginDelta: 0,
        },
        action: 'blocked' as const,
        reason: 'account critical',
        confidence: 0.5,
        guard: { degraded: true, constitutionTriggered: false, businessGuardTriggered: false },
      }]

      const result = await priceSentinelPipeline.execute(ctx, governed, context)
      expect(harness.updatePrice).not.toHaveBeenCalled()
      expect(result.blockedCount).toBe(1)
    })

    it('catches HarnessError and continues', async () => {
      const { ctx, harness } = createPipelineCtx()
      vi.mocked(harness.updatePrice).mockRejectedValueOnce(
        new HarnessError('shopify', '429', 'rate limited'),
      )
      const context = await priceSentinelPipeline.gather(ctx, {})
      const governed = [{
        decision: {
          productId: 'p-1', platform: 'shopify', currentPrice: 100, proposedPrice: 105,
          action: 'adjust' as const, reason: 'bump', confidence: 0.85, expectedMarginDelta: 2,
        },
        action: 'auto_execute' as const,
        reason: 'within threshold',
        confidence: 0.85,
        guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: false },
      }]

      const result = await priceSentinelPipeline.execute(ctx, governed, context)
      expect(result.executedCount).toBe(0)
      expect(ctx.logAction).toHaveBeenCalledWith('price_sentinel.harness_error', expect.objectContaining({
        code: '429',
      }))
    })
  })

  describe('remember', () => {
    it('records lake events for non-hold decisions', async () => {
      const { ctx } = createPipelineCtx()
      const dataOS = createDataOsMock()
      ctx.dataOS = dataOS

      const context = await priceSentinelPipeline.gather(ctx, {})
      const result = {
        decisions: [
          {
            decision: {
              productId: 'p-1', platform: 'shopify', currentPrice: 100, proposedPrice: 105,
              action: 'adjust' as const, reason: 'bump', confidence: 0.85, expectedMarginDelta: 2,
            },
            action: 'auto_execute' as const,
            reason: 'ok',
            confidence: 0.85,
            guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: false },
          },
        ],
        executedCount: 1, approvalCount: 0, blockedCount: 0, degradedCount: 0,
      }

      await priceSentinelPipeline.remember(ctx, result, context)
      expect(dataOS.recordLakeEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'price_changed',
        entityId: 'p-1',
      }))
    })

    it('skips hold decisions in remember phase', async () => {
      const { ctx } = createPipelineCtx()
      const dataOS = createDataOsMock()
      ctx.dataOS = dataOS

      const context = await priceSentinelPipeline.gather(ctx, {})
      const result = {
        decisions: [
          {
            decision: {
              productId: 'p-1', platform: 'shopify', currentPrice: 100, proposedPrice: 100,
              action: 'hold' as const, reason: 'fine', confidence: 0.9, expectedMarginDelta: 0,
            },
            action: 'auto_execute' as const,
            reason: 'hold',
            confidence: 0.9,
            guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: false },
          },
        ],
        executedCount: 0, approvalCount: 0, blockedCount: 0, degradedCount: 0,
      }

      await priceSentinelPipeline.remember(ctx, result, context)
      expect(dataOS.recordLakeEvent).not.toHaveBeenCalled()
    })
  })

  describe('runPipeline integration', () => {
    it('runs full pipeline end-to-end', async () => {
      const { ctx, harness } = createPipelineCtx({
        products: [{ id: 'p-1', title: 'Widget', price: 100, inventory: 50 }],
        llmResponse: JSON.stringify([{
          productId: 'p-1',
          action: 'adjust',
          proposedPrice: 105,
          reason: 'Small competitive adjustment',
          confidence: 0.85,
          expectedMarginDelta: 2.5,
        }]),
      })
      ctx.business = {
        unitEconomics: {
          getSkuEconomics: vi.fn().mockResolvedValue({
            grossRevenue: 1000, contributionMargin: 300, unitsSold: 25, tacos: 0.1,
          }),
          getDailyOverview: vi.fn().mockResolvedValue([
            { date: '2026-03-30', grossRevenue: 100, netRevenue: 80, totalCogs: 30, totalAdSpend: 10, contributionMargin: 40, orderCount: 5 },
          ]),
        },
        inventoryPlanning: { getInboundShipments: vi.fn(), getReplenishmentSuggestions: vi.fn() },
        accountHealth: { getHealthSummary: vi.fn().mockResolvedValue({ overallStatus: 'healthy' }), getListingIssues: vi.fn() },
        serviceOps: { getCases: vi.fn(), getRefundSummary: vi.fn() },
      }

      const result = await runPipeline(priceSentinelPipeline, ctx, {})

      expect(result.decisions).toHaveLength(1)
      expect(result.executedCount).toBe(1)
      expect(harness.updatePrice).toHaveBeenCalledWith('p-1', 105)
      expect(ctx.logAction).toHaveBeenCalledWith(
        'price-sentinel.pipeline.completed',
        expect.objectContaining({ total: 1, executed: 1 }),
      )
    })

    it('short-circuits when budget is exceeded', async () => {
      const { ctx, harness } = createPipelineCtx({ budgetExceeded: true })
      const result = await runPipeline(priceSentinelPipeline, ctx, {})

      expect(result.decisions).toEqual([])
      expect(result.executedCount).toBe(0)
      expect(harness.updatePrice).not.toHaveBeenCalled()
      expect(ctx.llm).not.toHaveBeenCalled()
    })

    it('degrades to suggest-only when profit data missing', async () => {
      const { ctx, harness } = createPipelineCtx({
        products: [{ id: 'p-1', title: 'Widget', price: 100, inventory: 50 }],
        llmResponse: JSON.stringify([{
          productId: 'p-1',
          action: 'adjust',
          proposedPrice: 105,
          reason: 'Small bump',
          confidence: 0.85,
          expectedMarginDelta: 2.5,
        }]),
      })

      const result = await runPipeline(priceSentinelPipeline, ctx, {})

      expect(harness.updatePrice).not.toHaveBeenCalled()
      expect(result.degradedCount).toBe(1)
    })
  })
})

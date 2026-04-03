import { describe, expect, it, vi } from 'vitest'
import type { TenantHarness } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import { DEFAULT_GOVERNANCE_SETTINGS } from '../ports.js'
import { NO_DEGRADATION, runPipeline } from '../decision-pipeline.js'
import { createDataOsMock } from './test-helpers.js'
import { inventoryGuardPipeline } from './inventory-guard.pipeline.js'
import type { InventoryReplenishProposal } from './inventory-guard.pipeline.js'

function inventoryHarness(levels?: Array<{ platformProductId: string; quantity: number; sku?: string }>) {
  return {
    tenantId: 't1',
    platformId: 'shopify',
    getProduct: vi.fn(),
    getProductsPage: vi.fn(),
    getProducts: vi.fn(),
    updatePrice: vi.fn(),
    updateInventory: vi.fn(),
    getOrdersPage: vi.fn(),
    getOrders: vi.fn(),
    replyToMessage: vi.fn(),
    getOpenThreads: vi.fn(),
    getAnalytics: vi.fn(),
    getInventoryLevels: vi.fn().mockResolvedValue(levels ?? [
      { platformProductId: 'p1', quantity: 2, sku: 'SKU-1' },
      { platformProductId: 'p2', quantity: 100, sku: 'SKU-2' },
    ]),
  }
}

function createPipelineCtx(overrides?: {
  budgetExceeded?: boolean
  levels?: Array<{ platformProductId: string; quantity: number; sku?: string }>
}): { ctx: AgentContext; harness: ReturnType<typeof inventoryHarness> } {
  const harness = inventoryHarness(overrides?.levels)

  const ctx: AgentContext = {
    tenantId: 'tenant-a',
    agentId: 'inventory-guard-pipeline',
    getHarness: () => harness as unknown as TenantHarness,
    getEnabledPlatforms: () => ['shopify'],
    llm: vi.fn().mockResolvedValue({ text: '[]' }),
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

describe('inventoryGuardPipeline', () => {
  describe('gather', () => {
    it('fetches inventory levels and filters alerts', async () => {
      const { ctx, harness } = createPipelineCtx()
      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10 })

      expect(harness.getInventoryLevels).toHaveBeenCalled()
      const alerts = context.platformData.alerts as unknown[]
      expect(alerts).toHaveLength(1)
    })

    it('returns preflight reason when budget exceeded', async () => {
      const { ctx } = createPipelineCtx({ budgetExceeded: true })
      const context = await inventoryGuardPipeline.gather(ctx, {})
      expect(context.platformData.preflight).toBe('budget_exceeded')
    })

    it('enriches alerts with business context', async () => {
      const { ctx } = createPipelineCtx({
        levels: [{ platformProductId: 'p1', quantity: 2, sku: 'SKU-1' }],
      })
      ctx.business = {
        unitEconomics: { getSkuEconomics: vi.fn(), getDailyOverview: vi.fn().mockResolvedValue([]) },
        inventoryPlanning: {
          getInboundShipments: vi.fn().mockResolvedValue([
            { id: 's1', sku: 'p1', productId: 'p1', platform: 'shopify', quantity: 50, status: 'in_transit', expectedArrival: '2026-05-01', supplier: 'X', leadTimeDays: 10, landedCostPerUnit: 1 },
          ]),
          getReplenishmentSuggestions: vi.fn().mockResolvedValue([
            { productId: 'p1', sku: 'p1', platform: 'shopify', currentStock: 2, dailyVelocity: 3, daysOfStock: 0.7, suggestedQty: 40, urgency: 'low' },
          ]),
        },
        accountHealth: { getHealthSummary: vi.fn().mockResolvedValue({ overallStatus: 'healthy' }), getListingIssues: vi.fn() },
        serviceOps: { getCases: vi.fn(), getRefundSummary: vi.fn() },
      }

      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10 })
      const alerts = context.platformData.alerts as Array<{ daysOfStock: number | null; nextInboundQty: number | null }>
      expect(alerts[0]?.daysOfStock).toBe(0.7)
      expect(alerts[0]?.nextInboundQty).toBe(50)
    })
  })

  describe('reason', () => {
    it('generates rule-based proposals for low-stock items', async () => {
      const { ctx } = createPipelineCtx({
        levels: [{ platformProductId: 'p1', quantity: 2, sku: 'SKU-1' }],
      })
      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10 })
      const decisions = await inventoryGuardPipeline.reason(ctx, context, { safetyThreshold: 10 })

      expect(decisions).toHaveLength(1)
      expect(decisions[0]?.status).toBe('low')
      expect(decisions[0]?.restockUnits).toBeGreaterThan(0)
    })

    it('returns empty for normal stock levels', async () => {
      const { ctx } = createPipelineCtx({
        levels: [{ platformProductId: 'p1', quantity: 100, sku: 'SKU-1' }],
      })
      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10 })
      const decisions = await inventoryGuardPipeline.reason(ctx, context, { safetyThreshold: 10 })
      expect(decisions).toEqual([])
    })

    it('returns empty when preflight blocks', async () => {
      const { ctx } = createPipelineCtx({ budgetExceeded: true })
      const context = await inventoryGuardPipeline.gather(ctx, {})
      const decisions = await inventoryGuardPipeline.reason(ctx, context, {})
      expect(decisions).toEqual([])
    })

    it('generates out_of_stock proposals', async () => {
      const { ctx } = createPipelineCtx({
        levels: [{ platformProductId: 'p1', quantity: 0, sku: 'SKU-1' }],
      })
      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10 })
      const decisions = await inventoryGuardPipeline.reason(ctx, context, { safetyThreshold: 10 })
      expect(decisions[0]?.status).toBe('out_of_stock')
      expect(decisions[0]?.confidence).toBe(0.9)
    })
  })

  describe('govern', () => {
    it('requires approval when restock >= replenishMin', async () => {
      const { ctx } = createPipelineCtx()
      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10, replenishApprovalMinUnits: 5 })
      context.degradation = { ...NO_DEGRADATION }
      const proposal: InventoryReplenishProposal = {
        platformProductId: 'p1', platform: 'shopify', sku: 'SKU-1',
        currentQuantity: 2, targetQuantity: 22, restockUnits: 20, status: 'low',
        reason: 'low stock', confidence: 0.7,
        daysOfStock: null, dailyVelocity: null, nextInboundQty: null, nextInboundEta: null,
      }

      const governed = await inventoryGuardPipeline.govern(ctx, [proposal], context)
      expect(governed[0]?.action).toBe('requires_approval')
    })

    it('auto-executes small restocks below replenishMin', async () => {
      const { ctx } = createPipelineCtx()
      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10, replenishApprovalMinUnits: 100 })
      context.degradation = { ...NO_DEGRADATION }
      const proposal: InventoryReplenishProposal = {
        platformProductId: 'p1', platform: 'shopify', sku: 'SKU-1',
        currentQuantity: 2, targetQuantity: 22, restockUnits: 20, status: 'low',
        reason: 'low stock', confidence: 0.7,
        daysOfStock: null, dailyVelocity: null, nextInboundQty: null, nextInboundEta: null,
      }

      const governed = await inventoryGuardPipeline.govern(ctx, [proposal], context)
      expect(governed[0]?.action).toBe('auto_execute')
    })

    it('blocks when days of stock runway is long', async () => {
      const { ctx } = createPipelineCtx()
      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10 })
      context.degradation = { ...NO_DEGRADATION }
      const proposal: InventoryReplenishProposal = {
        platformProductId: 'p1', platform: 'shopify', sku: 'SKU-1',
        currentQuantity: 5, targetQuantity: 25, restockUnits: 20, status: 'low',
        reason: 'low', confidence: 0.7,
        daysOfStock: 20, dailyVelocity: 0.1, nextInboundQty: null, nextInboundEta: null,
      }

      const governed = await inventoryGuardPipeline.govern(ctx, [proposal], context)
      expect(governed[0]?.action).toBe('blocked')
      expect(governed[0]?.guard.businessGuardTriggered).toBe(true)
    })

    it('blocks when inbound arrives before stockout', async () => {
      const { ctx } = createPipelineCtx()
      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10 })
      context.degradation = { ...NO_DEGRADATION }
      const etaSoon = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
      const proposal: InventoryReplenishProposal = {
        platformProductId: 'p1', platform: 'shopify', sku: 'SKU-1',
        currentQuantity: 5, targetQuantity: 25, restockUnits: 20, status: 'low',
        reason: 'low', confidence: 0.7,
        daysOfStock: 5, dailyVelocity: 1, nextInboundQty: 50, nextInboundEta: etaSoon,
      }

      const governed = await inventoryGuardPipeline.govern(ctx, [proposal], context)
      expect(governed[0]?.action).toBe('blocked')
    })

    it('applies degradation overlay', async () => {
      const { ctx } = createPipelineCtx()
      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10, replenishApprovalMinUnits: 100 })
      context.degradation = { ...NO_DEGRADATION, cashFlowTight: true }
      const proposal: InventoryReplenishProposal = {
        platformProductId: 'p1', platform: 'shopify', sku: 'SKU-1',
        currentQuantity: 2, targetQuantity: 22, restockUnits: 20, status: 'low',
        reason: 'low', confidence: 0.7,
        daysOfStock: null, dailyVelocity: null, nextInboundQty: null, nextInboundEta: null,
      }

      const governed = await inventoryGuardPipeline.govern(ctx, [proposal], context)
      expect(governed[0]?.action).toBe('degraded_suggest_only')
      expect(governed[0]?.guard.degraded).toBe(true)
    })
  })

  describe('execute', () => {
    it('creates ticket for auto_execute alerts', async () => {
      const { ctx } = createPipelineCtx()
      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10 })
      const governed = [{
        decision: {
          platformProductId: 'p1', platform: 'shopify', sku: 'SKU-1',
          currentQuantity: 2, targetQuantity: 22, restockUnits: 20, status: 'low' as const,
          reason: 'low stock', confidence: 0.7,
          daysOfStock: null, dailyVelocity: null, nextInboundQty: null, nextInboundEta: null,
        },
        action: 'auto_execute' as const,
        reason: 'small restock',
        confidence: 0.7,
        guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: false },
      }]

      const result = await inventoryGuardPipeline.execute(ctx, governed, context)
      expect(result.executedCount).toBe(1)
      expect(ctx.createTicket).toHaveBeenCalledWith(expect.objectContaining({
        title: expect.stringContaining('1 SKU(s) need restock'),
      }))
    })

    it('sends approval with rich payload for requires_approval', async () => {
      const { ctx } = createPipelineCtx()
      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10 })
      const governed = [{
        decision: {
          platformProductId: 'p1', platform: 'shopify', sku: 'SKU-1',
          currentQuantity: 2, targetQuantity: 52, restockUnits: 50, status: 'low' as const,
          reason: 'low stock', confidence: 0.7,
          daysOfStock: 0.7, dailyVelocity: 3.0, nextInboundQty: null, nextInboundEta: null,
        },
        action: 'requires_approval' as const,
        reason: 'large restock',
        confidence: 0.7,
        guard: { degraded: false, constitutionTriggered: true, businessGuardTriggered: false },
      }]

      const result = await inventoryGuardPipeline.execute(ctx, governed, context)
      expect(result.approvalCount).toBe(1)
      expect(ctx.requestApproval).toHaveBeenCalledWith(expect.objectContaining({
        action: 'inventory.adjust',
        payload: expect.objectContaining({
          displayTitle: expect.stringContaining('+50 units'),
          businessContext: expect.objectContaining({ daysOfStock: 0.7 }),
        }),
      }))
    })

    it('skips duplicate approvals', async () => {
      const { ctx } = createPipelineCtx()
      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10 })
      ;(context.platformData as Record<string, unknown>).pendingApprovals = [
        { action: 'inventory.adjust', payload: { platformProductId: 'p1', targetQuantity: 52 } },
      ]
      const governed = [{
        decision: {
          platformProductId: 'p1', platform: 'shopify', sku: 'SKU-1',
          currentQuantity: 2, targetQuantity: 52, restockUnits: 50, status: 'low' as const,
          reason: 'low', confidence: 0.7,
          daysOfStock: null, dailyVelocity: null, nextInboundQty: null, nextInboundEta: null,
        },
        action: 'requires_approval' as const,
        reason: 'large restock',
        confidence: 0.7,
        guard: { degraded: false, constitutionTriggered: true, businessGuardTriggered: false },
      }]

      const result = await inventoryGuardPipeline.execute(ctx, governed, context)
      expect(ctx.requestApproval).not.toHaveBeenCalled()
      expect(result.approvalCount).toBe(0)
    })

    it('logs deferred for blocked decisions', async () => {
      const { ctx } = createPipelineCtx()
      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10 })
      const governed = [{
        decision: {
          platformProductId: 'p1', platform: 'shopify', sku: 'SKU-1',
          currentQuantity: 5, targetQuantity: 25, restockUnits: 20, status: 'low' as const,
          reason: 'deferred', confidence: 0.5,
          daysOfStock: 20, dailyVelocity: 0.1, nextInboundQty: null, nextInboundEta: null,
        },
        action: 'blocked' as const,
        reason: 'runway sufficient',
        confidence: 0.5,
        guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: true },
      }]

      const result = await inventoryGuardPipeline.execute(ctx, governed, context)
      expect(result.blockedCount).toBe(1)
      expect(ctx.logAction).toHaveBeenCalledWith('inventory_guard.business_guard_deferred', expect.objectContaining({
        platformProductId: 'p1',
      }))
    })
  })

  describe('remember', () => {
    it('records lake events for non-blocked decisions', async () => {
      const { ctx } = createPipelineCtx()
      const dataOS = createDataOsMock()
      ctx.dataOS = dataOS

      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10 })
      const result = {
        decisions: [{
          decision: {
            platformProductId: 'p1', platform: 'shopify', sku: 'SKU-1',
            currentQuantity: 2, targetQuantity: 22, restockUnits: 20, status: 'low' as const,
            reason: 'low', confidence: 0.7,
            daysOfStock: null, dailyVelocity: null, nextInboundQty: null, nextInboundEta: null,
          },
          action: 'auto_execute' as const,
          reason: 'ok',
          confidence: 0.7,
          guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: false },
        }],
        executedCount: 1, approvalCount: 0, blockedCount: 0, degradedCount: 0,
      }

      await inventoryGuardPipeline.remember(ctx, result, context)
      expect(dataOS.recordLakeEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'inventory_restock',
        entityId: 'p1',
      }))
    })

    it('skips lake events for blocked decisions', async () => {
      const { ctx } = createPipelineCtx()
      const dataOS = createDataOsMock()
      ctx.dataOS = dataOS

      const context = await inventoryGuardPipeline.gather(ctx, { safetyThreshold: 10 })
      const result = {
        decisions: [{
          decision: {
            platformProductId: 'p1', platform: 'shopify', sku: 'SKU-1',
            currentQuantity: 5, targetQuantity: 25, restockUnits: 20, status: 'low' as const,
            reason: 'deferred', confidence: 0.5,
            daysOfStock: 20, dailyVelocity: 0.1, nextInboundQty: null, nextInboundEta: null,
          },
          action: 'blocked' as const,
          reason: 'deferred',
          confidence: 0.5,
          guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: true },
        }],
        executedCount: 0, approvalCount: 0, blockedCount: 1, degradedCount: 0,
      }

      await inventoryGuardPipeline.remember(ctx, result, context)
      expect(dataOS.recordLakeEvent).not.toHaveBeenCalled()
    })
  })

  describe('runPipeline integration', () => {
    it('runs full pipeline for low-stock items', async () => {
      const { ctx } = createPipelineCtx({
        levels: [{ platformProductId: 'p1', quantity: 2, sku: 'SKU-1' }],
      })
      ctx.business = {
        unitEconomics: {
          getSkuEconomics: vi.fn(),
          getDailyOverview: vi.fn().mockResolvedValue([
            { date: '2026-03-30', grossRevenue: 100, netRevenue: 80, totalCogs: 30, totalAdSpend: 10, contributionMargin: 40, orderCount: 5 },
          ]),
        },
        inventoryPlanning: {
          getInboundShipments: vi.fn().mockResolvedValue([]),
          getReplenishmentSuggestions: vi.fn().mockResolvedValue([]),
        },
        accountHealth: { getHealthSummary: vi.fn().mockResolvedValue({ overallStatus: 'healthy', openIssues: 0, resolvedLast30d: 0 }), getListingIssues: vi.fn() },
        serviceOps: { getCases: vi.fn(), getRefundSummary: vi.fn() },
      }

      const result = await runPipeline(inventoryGuardPipeline, ctx, {
        safetyThreshold: 10,
        replenishApprovalMinUnits: 100,
      })

      expect(result.decisions).toHaveLength(1)
      expect(result.executedCount).toBe(1)
      expect(ctx.createTicket).toHaveBeenCalled()
      expect(ctx.logAction).toHaveBeenCalledWith(
        'inventory-guard.pipeline.completed',
        expect.objectContaining({ total: 1, executed: 1 }),
      )
    })

    it('short-circuits when budget exceeded', async () => {
      const { ctx } = createPipelineCtx({ budgetExceeded: true })
      const result = await runPipeline(inventoryGuardPipeline, ctx, {})
      expect(result.decisions).toEqual([])
    })
  })
})

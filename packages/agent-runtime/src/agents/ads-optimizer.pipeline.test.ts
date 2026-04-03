import { describe, expect, it, vi } from 'vitest'
import type { TenantHarness } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import { DEFAULT_GOVERNANCE_SETTINGS } from '../ports.js'
import { NO_DEGRADATION, runPipeline } from '../decision-pipeline.js'
import { createDataOsMock } from './test-helpers.js'
import { adsOptimizerPipeline } from './ads-optimizer.pipeline.js'
import type { AdsBudgetProposal } from './ads-optimizer.pipeline.js'

function adsHarness(campaigns?: unknown[]) {
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
    supportsAds: true as const,
    getAdsCampaigns: vi.fn().mockResolvedValue(campaigns ?? [
      { platformCampaignId: 'c1', name: 'Campaign A', status: 'active', dailyBudget: 100, roas: 2, totalSpend: 500 },
      { platformCampaignId: 'c2', name: 'Campaign B', status: 'active', dailyBudget: 200, roas: 4, totalSpend: 1000 },
    ]),
    updateAdsBudget: vi.fn().mockResolvedValue(undefined),
  }
}

function createPipelineCtx(overrides?: {
  budgetExceeded?: boolean
  campaigns?: unknown[]
}): { ctx: AgentContext; harness: ReturnType<typeof adsHarness> } {
  const harness = adsHarness(overrides?.campaigns)

  const ctx: AgentContext = {
    tenantId: 'tenant-a',
    agentId: 'ads-optimizer-pipeline',
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

describe('adsOptimizerPipeline', () => {
  describe('gather', () => {
    it('fetches campaigns from harness', async () => {
      const { ctx, harness } = createPipelineCtx()
      const context = await adsOptimizerPipeline.gather(ctx, {})

      expect(harness.getAdsCampaigns).toHaveBeenCalled()
      const campaigns = context.platformData.campaigns as unknown[]
      expect(campaigns).toHaveLength(2)
    })

    it('returns preflight reason when budget exceeded', async () => {
      const { ctx } = createPipelineCtx({ budgetExceeded: true })
      const context = await adsOptimizerPipeline.gather(ctx, {})
      expect(context.platformData.preflight).toBe('budget_exceeded')
    })
  })

  describe('reason', () => {
    it('generates proposals using rule-based logic when no SOP', async () => {
      const { ctx } = createPipelineCtx({
        campaigns: [
          { platformCampaignId: 'c1', name: 'A', status: 'active', dailyBudget: 100, roas: 2, totalSpend: 500 },
        ],
      })
      const context = await adsOptimizerPipeline.gather(ctx, {})
      const decisions = await adsOptimizerPipeline.reason(ctx, context, {})

      expect(decisions).toHaveLength(1)
      expect(decisions[0]?.action).toBe('increase')
      expect(decisions[0]?.proposedDailyBudget).toBe(110)
    })

    it('skips campaigns that meet ROAS target', async () => {
      const { ctx } = createPipelineCtx({
        campaigns: [
          { platformCampaignId: 'c1', name: 'A', status: 'active', dailyBudget: 100, roas: 4, totalSpend: 500 },
        ],
      })
      const context = await adsOptimizerPipeline.gather(ctx, {})
      const decisions = await adsOptimizerPipeline.reason(ctx, context, {})
      expect(decisions).toEqual([])
    })

    it('returns empty when preflight blocks', async () => {
      const { ctx } = createPipelineCtx({ budgetExceeded: true })
      const context = await adsOptimizerPipeline.gather(ctx, {})
      const decisions = await adsOptimizerPipeline.reason(ctx, context, {})
      expect(decisions).toEqual([])
    })

    it('uses LLM when SOP is active', async () => {
      const { ctx } = createPipelineCtx({
        campaigns: [
          { platformCampaignId: 'c1', name: 'A', status: 'active', dailyBudget: 100, roas: 2, totalSpend: 500 },
        ],
      })
      vi.mocked(ctx.llm).mockResolvedValue({
        text: JSON.stringify([{
          platformCampaignId: 'c1',
          action: 'increase',
          proposedDailyBudget: 120,
          reason: 'SOP recommends aggressive growth',
          confidence: 0.9,
        }]),
      })
      vi.mocked(ctx.getActiveSop).mockResolvedValue({
        extractedGoalContext: { growthMode: true },
        extractedSystemPrompt: 'Be aggressive with ad spend',
        extractedGovernance: {},
      })

      const context = await adsOptimizerPipeline.gather(ctx, {})
      const decisions = await adsOptimizerPipeline.reason(ctx, context, {})

      expect(ctx.llm).toHaveBeenCalled()
      expect(decisions).toHaveLength(1)
      expect(decisions[0]?.proposedDailyBudget).toBe(120)
    })
  })

  describe('govern', () => {
    it('auto-executes when budget within threshold', async () => {
      const { ctx } = createPipelineCtx()
      const context = await adsOptimizerPipeline.gather(ctx, {})
      context.degradation = { ...NO_DEGRADATION }
      const proposal: AdsBudgetProposal = {
        platformCampaignId: 'c1', platform: 'shopify', campaignName: 'A',
        currentDailyBudget: 100, proposedDailyBudget: 110, currentRoas: 2,
        action: 'increase', reason: 'ROAS below target', confidence: 0.7,
      }

      const governed = await adsOptimizerPipeline.govern(ctx, [proposal], context)
      expect(governed[0]?.action).toBe('auto_execute')
    })

    it('requires approval when budget exceeds threshold', async () => {
      const { ctx } = createPipelineCtx()
      const context = await adsOptimizerPipeline.gather(ctx, {})
      context.degradation = { ...NO_DEGRADATION }
      const proposal: AdsBudgetProposal = {
        platformCampaignId: 'c1', platform: 'shopify', campaignName: 'A',
        currentDailyBudget: 480, proposedDailyBudget: 520, currentRoas: 2,
        action: 'increase', reason: 'big bump', confidence: 0.7,
      }

      const governed = await adsOptimizerPipeline.govern(ctx, [proposal], context)
      expect(governed[0]?.action).toBe('requires_approval')
      expect(governed[0]?.guard.constitutionTriggered).toBe(true)
    })

    it('blocks when account health is critical', async () => {
      const { ctx } = createPipelineCtx()
      const context = await adsOptimizerPipeline.gather(ctx, {})
      context.degradation = { ...NO_DEGRADATION }
      ;(context.platformData as Record<string, unknown>).healthContext = {
        overallStatus: 'critical',
        openIssues: 5,
        resolvedLast30d: 0,
      }
      const proposal: AdsBudgetProposal = {
        platformCampaignId: 'c1', platform: 'shopify', campaignName: 'A',
        currentDailyBudget: 100, proposedDailyBudget: 110, currentRoas: 2,
        action: 'increase', reason: 'bump', confidence: 0.7,
      }

      const governed = await adsOptimizerPipeline.govern(ctx, [proposal], context)
      expect(governed[0]?.action).toBe('blocked')
      expect(governed[0]?.guard.businessGuardTriggered).toBe(true)
    })

    it('requires approval when account at risk', async () => {
      const { ctx } = createPipelineCtx()
      const context = await adsOptimizerPipeline.gather(ctx, {})
      context.degradation = { ...NO_DEGRADATION }
      ;(context.platformData as Record<string, unknown>).healthContext = {
        overallStatus: 'at_risk',
        openIssues: 3,
        resolvedLast30d: 1,
      }
      const proposal: AdsBudgetProposal = {
        platformCampaignId: 'c1', platform: 'shopify', campaignName: 'A',
        currentDailyBudget: 100, proposedDailyBudget: 110, currentRoas: 2,
        action: 'increase', reason: 'bump', confidence: 0.7,
      }

      const governed = await adsOptimizerPipeline.govern(ctx, [proposal], context)
      expect(governed[0]?.action).toBe('requires_approval')
      expect(governed[0]?.guard.businessGuardTriggered).toBe(true)
    })

    it('applies degradation overlay', async () => {
      const { ctx } = createPipelineCtx()
      const context = await adsOptimizerPipeline.gather(ctx, {})
      context.degradation = { ...NO_DEGRADATION, accountHealthCritical: true }
      const proposal: AdsBudgetProposal = {
        platformCampaignId: 'c1', platform: 'shopify', campaignName: 'A',
        currentDailyBudget: 100, proposedDailyBudget: 110, currentRoas: 2,
        action: 'increase', reason: 'bump', confidence: 0.7,
      }

      const governed = await adsOptimizerPipeline.govern(ctx, [proposal], context)
      expect(governed[0]?.action).toBe('blocked')
      expect(governed[0]?.guard.degraded).toBe(true)
    })

    it('marks hold as auto_execute', async () => {
      const { ctx } = createPipelineCtx()
      const context = await adsOptimizerPipeline.gather(ctx, {})
      const proposal: AdsBudgetProposal = {
        platformCampaignId: 'c1', platform: 'shopify', campaignName: 'A',
        currentDailyBudget: 100, proposedDailyBudget: 100, currentRoas: 4,
        action: 'hold', reason: 'meets target', confidence: 0.9,
      }

      const governed = await adsOptimizerPipeline.govern(ctx, [proposal], context)
      expect(governed[0]?.action).toBe('auto_execute')
    })
  })

  describe('execute', () => {
    it('calls updateAdsBudget for auto_execute', async () => {
      const { ctx, harness } = createPipelineCtx()
      const context = await adsOptimizerPipeline.gather(ctx, {})
      const governed = [{
        decision: {
          platformCampaignId: 'c1', platform: 'shopify', campaignName: 'A',
          currentDailyBudget: 100, proposedDailyBudget: 110, currentRoas: 2,
          action: 'increase' as const, reason: 'bump', confidence: 0.7,
        },
        action: 'auto_execute' as const,
        reason: 'within threshold',
        confidence: 0.7,
        guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: false },
      }]

      const result = await adsOptimizerPipeline.execute(ctx, governed, context)
      expect(harness.updateAdsBudget).toHaveBeenCalledWith('c1', 110)
      expect(result.executedCount).toBe(1)
    })

    it('sends approval with rich payload for requires_approval', async () => {
      const { ctx, harness } = createPipelineCtx()
      const context = await adsOptimizerPipeline.gather(ctx, {})
      const governed = [{
        decision: {
          platformCampaignId: 'c1', platform: 'shopify', campaignName: 'A',
          currentDailyBudget: 480, proposedDailyBudget: 520, currentRoas: 2,
          action: 'increase' as const, reason: 'big', confidence: 0.7,
        },
        action: 'requires_approval' as const,
        reason: 'exceeds threshold',
        confidence: 0.7,
        guard: { degraded: false, constitutionTriggered: true, businessGuardTriggered: false },
      }]

      const result = await adsOptimizerPipeline.execute(ctx, governed, context)
      expect(harness.updateAdsBudget).not.toHaveBeenCalled()
      expect(ctx.requestApproval).toHaveBeenCalledWith(expect.objectContaining({
        action: 'ads.set_budget',
        payload: expect.objectContaining({
          displayTitle: expect.stringContaining('$520.00'),
          rollbackPlan: expect.stringContaining('$480.00'),
        }),
      }))
      expect(result.approvalCount).toBe(1)
    })

    it('skips duplicate approvals', async () => {
      const { ctx } = createPipelineCtx()
      const context = await adsOptimizerPipeline.gather(ctx, {})
      ;(context.platformData as Record<string, unknown>).pendingApprovals = [
        { action: 'ads.set_budget', payload: { platformCampaignId: 'c1', proposedDailyBudgetUsd: 520 } },
      ]
      const governed = [{
        decision: {
          platformCampaignId: 'c1', platform: 'shopify', campaignName: 'A',
          currentDailyBudget: 480, proposedDailyBudget: 520, currentRoas: 2,
          action: 'increase' as const, reason: 'big', confidence: 0.7,
        },
        action: 'requires_approval' as const,
        reason: 'exceeds threshold',
        confidence: 0.7,
        guard: { degraded: false, constitutionTriggered: true, businessGuardTriggered: false },
      }]

      const result = await adsOptimizerPipeline.execute(ctx, governed, context)
      expect(ctx.requestApproval).not.toHaveBeenCalled()
      expect(result.approvalCount).toBe(0)
    })

    it('logs suggestion for degraded_suggest_only', async () => {
      const { ctx, harness } = createPipelineCtx()
      const context = await adsOptimizerPipeline.gather(ctx, {})
      const governed = [{
        decision: {
          platformCampaignId: 'c1', platform: 'shopify', campaignName: 'A',
          currentDailyBudget: 100, proposedDailyBudget: 110, currentRoas: 2,
          action: 'increase' as const, reason: 'suggestion', confidence: 0.6,
        },
        action: 'degraded_suggest_only' as const,
        reason: 'profit data missing',
        confidence: 0.6,
        guard: { degraded: true, constitutionTriggered: false, businessGuardTriggered: false },
      }]

      const result = await adsOptimizerPipeline.execute(ctx, governed, context)
      expect(harness.updateAdsBudget).not.toHaveBeenCalled()
      expect(result.degradedCount).toBe(1)
    })

    it('blocks and logs for blocked decisions', async () => {
      const { ctx, harness } = createPipelineCtx()
      const context = await adsOptimizerPipeline.gather(ctx, {})
      const governed = [{
        decision: {
          platformCampaignId: 'c1', platform: 'shopify', campaignName: 'A',
          currentDailyBudget: 100, proposedDailyBudget: 110, currentRoas: 2,
          action: 'increase' as const, reason: 'blocked', confidence: 0.5,
        },
        action: 'blocked' as const,
        reason: 'account critical',
        confidence: 0.5,
        guard: { degraded: true, constitutionTriggered: false, businessGuardTriggered: true },
      }]

      const result = await adsOptimizerPipeline.execute(ctx, governed, context)
      expect(harness.updateAdsBudget).not.toHaveBeenCalled()
      expect(result.blockedCount).toBe(1)
    })
  })

  describe('remember', () => {
    it('records lake events for non-hold decisions', async () => {
      const { ctx } = createPipelineCtx()
      const dataOS = createDataOsMock()
      ctx.dataOS = dataOS

      const context = await adsOptimizerPipeline.gather(ctx, {})
      const result = {
        decisions: [{
          decision: {
            platformCampaignId: 'c1', platform: 'shopify', campaignName: 'A',
            currentDailyBudget: 100, proposedDailyBudget: 110, currentRoas: 2,
            action: 'increase' as const, reason: 'bump', confidence: 0.7,
          },
          action: 'auto_execute' as const,
          reason: 'ok',
          confidence: 0.7,
          guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: false },
        }],
        executedCount: 1, approvalCount: 0, blockedCount: 0, degradedCount: 0,
      }

      await adsOptimizerPipeline.remember(ctx, result, context)
      expect(dataOS.recordLakeEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'ads_budget_changed',
        entityId: 'c1',
      }))
    })
  })

  describe('runPipeline integration', () => {
    it('runs full pipeline with rule-based reasoning', async () => {
      const { ctx, harness } = createPipelineCtx({
        campaigns: [
          { platformCampaignId: 'c1', name: 'A', status: 'active', dailyBudget: 100, roas: 2, totalSpend: 500 },
        ],
      })
      ctx.business = {
        unitEconomics: {
          getSkuEconomics: vi.fn(),
          getDailyOverview: vi.fn().mockResolvedValue([
            { date: '2026-03-30', grossRevenue: 100, netRevenue: 80, totalCogs: 30, totalAdSpend: 10, contributionMargin: 40, orderCount: 5 },
          ]),
        },
        inventoryPlanning: { getInboundShipments: vi.fn(), getReplenishmentSuggestions: vi.fn() },
        accountHealth: { getHealthSummary: vi.fn().mockResolvedValue({ overallStatus: 'healthy', openIssues: 0, resolvedLast30d: 0 }), getListingIssues: vi.fn() },
        serviceOps: { getCases: vi.fn(), getRefundSummary: vi.fn() },
      }

      const result = await runPipeline(adsOptimizerPipeline, ctx, {})

      expect(result.decisions).toHaveLength(1)
      expect(result.executedCount).toBe(1)
      expect(harness.updateAdsBudget).toHaveBeenCalledWith('c1', 110)
      expect(ctx.logAction).toHaveBeenCalledWith(
        'ads-optimizer.pipeline.completed',
        expect.objectContaining({ total: 1, executed: 1 }),
      )
    })

    it('short-circuits when budget is exceeded', async () => {
      const { ctx, harness } = createPipelineCtx({ budgetExceeded: true })
      const result = await runPipeline(adsOptimizerPipeline, ctx, {})
      expect(result.decisions).toEqual([])
      expect(harness.updateAdsBudget).not.toHaveBeenCalled()
    })
  })
})

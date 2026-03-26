import { describe, expect, it, vi } from 'vitest'
import type { TenantHarness } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import { runAdsOptimizer } from './ads-optimizer.agent.js'

function baseHarness(): TenantHarness & {
  supportsAds: true
  getAdsCampaigns: () => Promise<unknown[]>
  updateAdsBudget: (id: string, usd: number) => Promise<void>
} {
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
    getAdsCampaigns: vi.fn().mockResolvedValue([]),
    updateAdsBudget: vi.fn().mockResolvedValue(undefined),
  }
}

function createCtx(overrides: {
  platforms?: string[]
  harness?: ReturnType<typeof baseHarness>
  budgetExceeded?: boolean
}): AgentContext & { requestApproval: ReturnType<typeof vi.fn> } {
  const logAction = vi.fn().mockResolvedValue(undefined)
  const requestApproval = vi.fn().mockResolvedValue(undefined)
  const h = overrides.harness ?? baseHarness()
  return {
    tenantId: 't1',
    agentId: 'a1',
    getHarness: () => h,
    getEnabledPlatforms: () => overrides.platforms ?? ['shopify'],
    llm: vi.fn(),
    budget: {
      isExceeded: vi.fn().mockResolvedValue(overrides.budgetExceeded ?? false),
    },
    logAction,
    requestApproval,
    createTicket: vi.fn(),
    describeDataOsCapabilities: () => 'DataOS not available',
  }
}

describe('runAdsOptimizer', () => {
  it('returns synced 0 and empty perPlatform when no platforms', async () => {
    const ctx = createCtx({ platforms: [] })
    const result = await runAdsOptimizer(ctx, {})
    expect(result.synced).toBe(0)
    expect(result.perPlatform).toEqual([])
    expect(result.runId.length).toBeGreaterThan(8)
    expect(ctx.logAction).toHaveBeenCalledWith(
      'ads_optimizer.no_platforms',
      expect.objectContaining({ runId: result.runId }),
    )
  })

  it('skips platform when harness is not ads-capable', async () => {
    const bare = {
      ...baseHarness(),
      supportsAds: undefined as unknown as true,
      getAdsCampaigns: undefined as unknown as () => Promise<unknown[]>,
    }
    delete (bare as { getAdsCampaigns?: unknown }).getAdsCampaigns
    delete (bare as { supportsAds?: unknown }).supportsAds
    const ctx = createCtx({
      platforms: ['amazon'],
      harness: bare as unknown as ReturnType<typeof baseHarness>,
    })
    const result = await runAdsOptimizer(ctx, {})
    expect(result.synced).toBe(0)
    expect(result.perPlatform[0]?.skipReason).toBe('not_ads_capable')
  })

  it('syncs campaigns, persists, and applies budget when below approval threshold', async () => {
    const campaigns = [
      {
        platformCampaignId: 'c1',
        name: 'A',
        status: 'active' as const,
        dailyBudget: 400,
        totalSpend: 1,
        roas: 2,
      },
    ]
    const h = baseHarness()
    h.getAdsCampaigns = vi.fn().mockResolvedValue(campaigns)
    const persistCampaigns = vi.fn().mockResolvedValue(undefined)
    const ctx = createCtx({ harness: h })
    const result = await runAdsOptimizer(ctx, { persistCampaigns })
    expect(result.synced).toBe(1)
    expect(result.budgetUpdatesApplied).toBe(1)
    expect(result.approvalsRequested).toBe(0)
    expect(h.updateAdsBudget).toHaveBeenCalledWith('c1', 440)
    expect(ctx.requestApproval).not.toHaveBeenCalled()
    expect(persistCampaigns).toHaveBeenCalledWith({ platform: 'shopify', campaigns })
  })

  it('requests approval and does not call updateAdsBudget when proposed budget exceeds threshold', async () => {
    const campaigns = [
      {
        platformCampaignId: 'big',
        name: 'B',
        status: 'active' as const,
        dailyBudget: 460,
        roas: 2,
      },
    ]
    const h = baseHarness()
    h.getAdsCampaigns = vi.fn().mockResolvedValue(campaigns)
    const ctx = createCtx({ harness: h })
    const result = await runAdsOptimizer(ctx, {})
    expect(result.approvalsRequested).toBe(1)
    expect(result.budgetUpdatesApplied).toBe(0)
    expect(h.updateAdsBudget).not.toHaveBeenCalled()
    expect(ctx.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ads.set_budget',
        payload: expect.objectContaining({
          platformCampaignId: 'big',
          proposedDailyBudgetUsd: 506,
        }),
      }),
    )
    expect(ctx.logAction).toHaveBeenCalledWith(
      'ads_optimizer.approval_requested',
      expect.objectContaining({ keyword: 'ADS_BUDGET_APPROVAL_THRESHOLD' }),
    )
  })

  it('does not request approval again when identical pending exists', async () => {
    const campaigns = [
      {
        platformCampaignId: 'big',
        name: 'B',
        status: 'active' as const,
        dailyBudget: 460,
        roas: 2,
      },
    ]
    const h = baseHarness()
    h.getAdsCampaigns = vi.fn().mockResolvedValue(campaigns)
    const ctx = createCtx({ harness: h })
    const result = await runAdsOptimizer(ctx, {
      hasPendingAdsBudgetApproval: vi.fn().mockResolvedValue(true),
    })
    expect(result.approvalsRequested).toBe(0)
    expect(ctx.requestApproval).not.toHaveBeenCalled()
    expect(ctx.logAction).toHaveBeenCalledWith(
      'ads_optimizer.approval_duplicate_skipped',
      expect.objectContaining({ keyword: 'ADS_BUDGET_PENDING_DEDUPE' }),
    )
  })

  it('skips budget action when ROAS meets target', async () => {
    const campaigns = [
      {
        platformCampaignId: 'ok',
        name: 'O',
        status: 'active' as const,
        dailyBudget: 100,
        roas: 3.5,
      },
    ]
    const h = baseHarness()
    h.getAdsCampaigns = vi.fn().mockResolvedValue(campaigns)
    const ctx = createCtx({ harness: h })
    const result = await runAdsOptimizer(ctx, {})
    expect(result.budgetUpdatesApplied).toBe(0)
    expect(result.approvalsRequested).toBe(0)
    expect(h.updateAdsBudget).not.toHaveBeenCalled()
  })

  it('propagates persist failure', async () => {
    const h = baseHarness()
    h.getAdsCampaigns = vi.fn().mockResolvedValue([
      { platformCampaignId: 'c1', name: 'A', status: 'active' as const, dailyBudget: 10, roas: 2 },
    ])
    const persistCampaigns = vi.fn().mockRejectedValue(new Error('db down'))
    const ctx = createCtx({ harness: h })
    await expect(runAdsOptimizer(ctx, { persistCampaigns })).rejects.toThrow('db down')
  })

  it('skips when budget exceeded', async () => {
    const ctx = createCtx({ platforms: ['shopify'], budgetExceeded: true })
    const result = await runAdsOptimizer(ctx, {})
    expect(result.budgetExceeded).toBe(true)
    expect(result.synced).toBe(0)
  })

  it('records harness_error when getAdsCampaigns throws', async () => {
    const h = baseHarness()
    h.getAdsCampaigns = vi.fn().mockRejectedValue(new Error('rate limited'))
    const ctx = createCtx({ harness: h })
    const result = await runAdsOptimizer(ctx, {})
    expect(result.synced).toBe(0)
    expect(result.perPlatform[0]?.skipReason).toBe('harness_error')
  })
})

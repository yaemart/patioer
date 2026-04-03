import { describe, expect, it, vi } from 'vitest'
import { HarnessError } from '@patioer/harness'
import type { TenantHarness } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import { DEFAULT_GOVERNANCE_SETTINGS } from '../ports.js'
import type { DataOsPort } from '../types.js'
import { runMarketIntel } from './market-intel.agent.js'
import { createHarnessMock, createDataOsMock } from './test-helpers.js'

const VALID_LLM_JSON = JSON.stringify({
  competitorMinPrice: 15.99,
  competitorAvgPrice: 22.5,
  pricePosition: 'below',
  recommendation: 'Consider raising price to match market average',
})

function createCtx(overrides?: {
  budgetExceeded?: boolean
  llmText?: string
  products?: Array<{ id: string; title: string; price: number | null; inventory: number | null }>
  withDataOS?: boolean
  enabledPlatforms?: string[]
  harnessError?: boolean
}): { ctx: AgentContext; harness: TenantHarness; dataOS: DataOsPort } {
  const products = overrides?.products ?? [
    { id: 'p-1', title: 'Widget A', price: 19.99, inventory: 50 },
    { id: 'p-2', title: 'Gadget B', price: 49.99, inventory: 20 },
  ]
  const harness = createHarnessMock()
  vi.mocked(harness.getProducts).mockResolvedValue(products)
  if (overrides?.harnessError) {
    vi.mocked(harness.getProducts).mockRejectedValue(
      new HarnessError('shopify', '429', 'rate limited'),
    )
  }
  const dataOS = createDataOsMock()
  const enabledPlatforms = overrides?.enabledPlatforms ?? ['shopify']

  const ctx: AgentContext = {
    tenantId: 'tenant-a',
    agentId: 'agent-mi',
    getHarness: (_platform?: string) => harness,
    getEnabledPlatforms: () => enabledPlatforms,
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
    describeDataOsCapabilities: () => 'DataOS not available',
    dataOS: overrides?.withDataOS !== false ? dataOS : undefined,
    getGovernanceSettings: vi.fn().mockResolvedValue({ ...DEFAULT_GOVERNANCE_SETTINGS }),
    getEffectiveGovernance: vi.fn().mockResolvedValue({ ...DEFAULT_GOVERNANCE_SETTINGS }),
    isHumanInLoop: vi.fn().mockResolvedValue(false),
    getActiveSop: vi.fn().mockResolvedValue(null),
  }
  return { ctx, harness, dataOS }
}

describe('runMarketIntel', () => {
  it('analyzes products and returns insights with competitor pricing', async () => {
    const { ctx } = createCtx()

    const result = await runMarketIntel(ctx, {})

    expect(result.runId).toBeTruthy()
    expect(result.analyzedProducts).toBe(2)
    expect(result.insights).toHaveLength(2)
    expect(result.insights[0]).toMatchObject({
      productId: 'p-1',
      platform: 'shopify',
      competitorMinPrice: 15.99,
      competitorAvgPrice: 22.5,
      pricePosition: 'below',
    })
  })

  it('returns empty result when budget is exceeded', async () => {
    const { ctx } = createCtx({ budgetExceeded: true })

    const result = await runMarketIntel(ctx, {})

    expect(result.analyzedProducts).toBe(0)
    expect(result.insights).toEqual([])
    expect(result.featuresUpdated).toBe(0)
    expect(ctx.llm).not.toHaveBeenCalled()
    expect(ctx.logAction).toHaveBeenCalledWith('market_intel.budget_exceeded', expect.any(Object))
  })

  it('uses ctx.getEnabledPlatforms() when input.platforms is undefined', async () => {
    const { ctx } = createCtx({ enabledPlatforms: ['shopify', 'amazon'] })
    const getHarnessSpy = vi.fn(ctx.getHarness)
    ctx.getHarness = getHarnessSpy

    await runMarketIntel(ctx, {})

    expect(getHarnessSpy).toHaveBeenCalledWith('shopify')
    expect(getHarnessSpy).toHaveBeenCalledWith('amazon')
  })

  it('uses input.platforms when provided', async () => {
    const { ctx } = createCtx({ enabledPlatforms: ['shopify', 'amazon'] })
    const getHarnessSpy = vi.fn(ctx.getHarness)
    ctx.getHarness = getHarnessSpy

    await runMarketIntel(ctx, { platforms: ['amazon'] })

    expect(getHarnessSpy).toHaveBeenCalledWith('amazon')
    expect(getHarnessSpy).not.toHaveBeenCalledWith('shopify')
  })

  it('respects maxProducts limit', async () => {
    const { ctx, harness } = createCtx()

    await runMarketIntel(ctx, { maxProducts: 10 })

    expect(harness.getProducts).toHaveBeenCalledWith({ limit: 10 })
  })

  it('clamps oversized maxProducts to the hard limit', async () => {
    const { ctx, harness } = createCtx()

    await runMarketIntel(ctx, { maxProducts: 500 })

    expect(harness.getProducts).toHaveBeenCalledWith({ limit: 50 })
  })

  it('uses default maxProducts of 50', async () => {
    const { ctx, harness } = createCtx()

    await runMarketIntel(ctx, {})

    expect(harness.getProducts).toHaveBeenCalledWith({ limit: 50 })
  })

  it('skips platform when harness.getProducts fails', async () => {
    const { ctx } = createCtx({ harnessError: true })

    const result = await runMarketIntel(ctx, {})

    expect(result.analyzedProducts).toBe(0)
    expect(result.insights).toEqual([])
    expect(ctx.logAction).toHaveBeenCalledWith(
      'market_intel.platform_skipped',
      expect.objectContaining({ platform: 'shopify', code: '429' }),
    )
  })

  it('skips individual product on LLM failure without aborting run', async () => {
    const { ctx } = createCtx()
    vi.mocked(ctx.llm)
      .mockRejectedValueOnce(new Error('LLM timeout'))
      .mockResolvedValueOnce({ text: VALID_LLM_JSON })

    const result = await runMarketIntel(ctx, {})

    expect(result.analyzedProducts).toBe(1)
    expect(result.insights).toHaveLength(1)
    expect(result.insights[0]?.productId).toBe('p-2')
    expect(ctx.logAction).toHaveBeenCalledWith(
      'market_intel.llm_failed',
      expect.objectContaining({ productId: 'p-1' }),
    )
  })

  it('skips product when LLM returns unparseable response', async () => {
    const { ctx } = createCtx({ llmText: 'I cannot analyze this product' })

    const result = await runMarketIntel(ctx, {})

    expect(result.analyzedProducts).toBe(0)
    expect(result.insights).toEqual([])
    expect(ctx.logAction).toHaveBeenCalledWith(
      'market_intel.parse_failed',
      expect.objectContaining({ productId: 'p-1' }),
    )
  })

  it('fetches DataOS features for each product', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: true })

    await runMarketIntel(ctx, {})

    expect(dataOS.getFeatures).toHaveBeenCalledWith('shopify', 'p-1')
    expect(dataOS.getFeatures).toHaveBeenCalledWith('shopify', 'p-2')
  })

  it('upserts competitor features into Feature Store via dataOS', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: true })

    const result = await runMarketIntel(ctx, {})

    expect(result.featuresUpdated).toBe(2)
    expect(dataOS.upsertFeature).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'shopify',
        productId: 'p-1',
        competitorMinPrice: 15.99,
        competitorAvgPrice: 22.5,
        pricePosition: 'below',
      }),
    )
  })

  it('records lake event after completion', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: true })

    await runMarketIntel(ctx, {})

    expect(dataOS.recordLakeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'shopify',
        eventType: 'market_intel_completed',
        metadata: expect.objectContaining({ agentType: 'market-intel' }),
      }),
    )
  })

  it('handles dataOS.upsertFeature failure gracefully', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: true })
    vi.mocked(dataOS.upsertFeature).mockRejectedValue(new Error('write failed'))

    const result = await runMarketIntel(ctx, {})

    expect(result.analyzedProducts).toBe(2)
    expect(result.featuresUpdated).toBe(0)
    expect(ctx.logAction).toHaveBeenCalledWith(
      'market_intel.dataos_write_failed',
      expect.objectContaining({ op: 'upsertFeature' }),
    )
  })

  it('handles dataOS.getFeatures failure gracefully', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: true })
    vi.mocked(dataOS.getFeatures).mockRejectedValue(new Error('timeout'))

    const result = await runMarketIntel(ctx, {})

    expect(result.analyzedProducts).toBe(2)
    expect(ctx.logAction).toHaveBeenCalledWith(
      'market_intel.dataos_degraded',
      expect.objectContaining({ op: 'getFeatures' }),
    )
  })

  it('handles dataOS.recordLakeEvent failure gracefully', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: true })
    vi.mocked(dataOS.recordLakeEvent).mockRejectedValue(new Error('lake write failed'))

    const result = await runMarketIntel(ctx, {})

    expect(result.analyzedProducts).toBe(2)
    expect(result.insights).toHaveLength(2)
    expect(ctx.logAction).toHaveBeenCalledWith(
      'market_intel.dataos_write_failed',
      expect.objectContaining({ op: 'recordLakeEvent' }),
    )
  })

  it('operates normally when dataOS is undefined (degraded mode)', async () => {
    const { ctx, dataOS } = createCtx({ withDataOS: false })

    const result = await runMarketIntel(ctx, {})

    expect(result.analyzedProducts).toBe(2)
    expect(result.insights).toHaveLength(2)
    expect(result.featuresUpdated).toBe(0)
    expect(dataOS.getFeatures).not.toHaveBeenCalled()
    expect(dataOS.upsertFeature).not.toHaveBeenCalled()
    expect(dataOS.recordLakeEvent).not.toHaveBeenCalled()
  })

  it('logs started and completed actions', async () => {
    const { ctx } = createCtx()

    await runMarketIntel(ctx, {})

    expect(ctx.logAction).toHaveBeenCalledWith(
      'market_intel.run.started',
      expect.objectContaining({ platforms: ['shopify'] }),
    )
    expect(ctx.logAction).toHaveBeenCalledWith(
      'market_intel.run.completed',
      expect.objectContaining({ analyzedProducts: 2 }),
    )
  })

  it('includes recommendation from LLM when present', async () => {
    const { ctx } = createCtx()

    const result = await runMarketIntel(ctx, {})

    expect(result.insights[0]?.recommendation).toBe(
      'Consider raising price to match market average',
    )
  })

  it('handles LLM response with invalid price numbers', async () => {
    const { ctx } = createCtx({
      llmText: JSON.stringify({
        competitorMinPrice: 'not a number',
        competitorAvgPrice: null,
        pricePosition: 'below',
      }),
    })

    const result = await runMarketIntel(ctx, {})

    expect(result.analyzedProducts).toBe(0)
    expect(ctx.logAction).toHaveBeenCalledWith(
      'market_intel.parse_failed',
      expect.objectContaining({ productId: 'p-1' }),
    )
  })
})

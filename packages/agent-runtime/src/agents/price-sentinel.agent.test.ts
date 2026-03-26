import { describe, expect, it, vi } from 'vitest'
import { HarnessError } from '@patioer/harness'
import type { TenantHarness } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import { runPriceSentinel } from './price-sentinel.agent.js'

function createHarnessMock(): TenantHarness {
  return {
    tenantId: 'tenant-a',
    platformId: 'shopify',
    getProduct: vi.fn().mockResolvedValue(null),
    getProductsPage: vi.fn().mockResolvedValue({ items: [] }),
    getProducts: vi.fn().mockResolvedValue([]),
    updatePrice: vi.fn().mockResolvedValue(undefined),
    updateInventory: vi.fn().mockResolvedValue(undefined),
    getOrdersPage: vi.fn().mockResolvedValue({ items: [] }),
    getOrders: vi.fn().mockResolvedValue([]),
    replyToMessage: vi.fn().mockResolvedValue(undefined),
    getOpenThreads: vi.fn().mockResolvedValue([]),
    getAnalytics: vi.fn().mockResolvedValue({ revenue: 0, orders: 0 }),
  }
}

function createCtx(overrides?: {
  budgetExceeded?: boolean
}): { ctx: AgentContext; harness: TenantHarness } {
  const harness = createHarnessMock()
  const logAction = vi.fn().mockResolvedValue(undefined)
  const requestApproval = vi.fn().mockResolvedValue(undefined)
  const createTicket = vi.fn().mockResolvedValue(undefined)

  const ctx: AgentContext = {
    tenantId: 'tenant-a',
    agentId: 'agent-a',
    getHarness: (_platform?: string) => harness,
    getEnabledPlatforms: () => ['shopify'],
    llm: vi.fn().mockResolvedValue({ text: 'ok' }),
    budget: {
      isExceeded: vi.fn().mockResolvedValue(overrides?.budgetExceeded ?? false),
    },
    logAction,
    requestApproval,
    createTicket,
    describeDataOsCapabilities: () => 'DataOS not available',
  }

  return { ctx, harness }
}

describe('runPriceSentinel', () => {
  it('updates price directly when delta is within threshold', async () => {
    const { ctx, harness } = createCtx()
    const result = await runPriceSentinel(ctx, {
      proposals: [
        {
          productId: 'p-1',
          currentPrice: 100,
          proposedPrice: 110,
          reason: 'small move',
        },
      ],
    })

    expect(harness.updatePrice).toHaveBeenCalledWith('p-1', 110)
    expect(ctx.requestApproval).not.toHaveBeenCalled()
    expect(result.decisions[0]?.requiresApproval).toBe(false)
  })

  it('requests approval when delta exceeds threshold', async () => {
    const { ctx, harness } = createCtx()
    const result = await runPriceSentinel(ctx, {
      proposals: [
        {
          productId: 'p-1',
          currentPrice: 100,
          proposedPrice: 130,
          reason: 'large move',
        },
      ],
    })

    expect(ctx.requestApproval).toHaveBeenCalledTimes(1)
    expect(harness.updatePrice).not.toHaveBeenCalled()
    expect(result.decisions[0]?.requiresApproval).toBe(true)
  })

  it('uses default threshold 15 when input threshold is omitted', async () => {
    const { ctx } = createCtx()
    const result = await runPriceSentinel(ctx, {
      proposals: [
        {
          productId: 'p-1',
          currentPrice: 100,
          proposedPrice: 116,
          reason: 'just over default',
        },
      ],
    })
    expect(result.decisions[0]?.requiresApproval).toBe(true)
  })

  it('respects custom threshold from input', async () => {
    const { ctx } = createCtx()
    const result = await runPriceSentinel(ctx, {
      approvalThresholdPercent: 20,
      proposals: [
        {
          productId: 'p-1',
          currentPrice: 100,
          proposedPrice: 116,
          reason: 'below custom threshold',
        },
      ],
    })
    expect(result.decisions[0]?.requiresApproval).toBe(false)
  })

  it('skips execution when budget is exceeded', async () => {
    const { ctx, harness } = createCtx({ budgetExceeded: true })
    const result = await runPriceSentinel(ctx, {
      proposals: [
        {
          productId: 'p-1',
          currentPrice: 100,
          proposedPrice: 110,
          reason: 'small move',
        },
      ],
    })
    expect(result.decisions).toEqual([])
    expect(harness.updatePrice).not.toHaveBeenCalled()
    expect(ctx.requestApproval).not.toHaveBeenCalled()
  })

  it('logs started and completed actions', async () => {
    const { ctx } = createCtx()
    await runPriceSentinel(ctx, {
      proposals: [
        {
          productId: 'p-1',
          currentPrice: 100,
          proposedPrice: 110,
          reason: 'small move',
        },
      ],
    })

    expect(ctx.logAction).toHaveBeenCalledWith(
      'price_sentinel.run.started',
      expect.objectContaining({ proposalCount: 1 }),
    )
    expect(ctx.logAction).toHaveBeenCalledWith(
      'price_sentinel.run.completed',
      expect.objectContaining({ decisionCount: 1 }),
    )
  })

  it('logs approval_requested for gated updates', async () => {
    const { ctx } = createCtx()
    await runPriceSentinel(ctx, {
      proposals: [
        {
          productId: 'p-1',
          currentPrice: 100,
          proposedPrice: 140,
          reason: 'large move',
        },
      ],
    })
    expect(ctx.logAction).toHaveBeenCalledWith(
      'price_sentinel.approval_requested',
      expect.any(Object),
    )
  })

  it('logs price_updated for auto updates', async () => {
    const { ctx } = createCtx()
    await runPriceSentinel(ctx, {
      proposals: [
        {
          productId: 'p-1',
          currentPrice: 100,
          proposedPrice: 105,
          reason: 'small move',
        },
      ],
    })
    expect(ctx.logAction).toHaveBeenCalledWith(
      'price_sentinel.price_updated',
      expect.any(Object),
    )
  })

  it('throws when proposedPrice is not positive number', async () => {
    const { ctx } = createCtx()
    await expect(
      runPriceSentinel(ctx, {
        proposals: [
          {
            productId: 'p-1',
            currentPrice: 100,
            proposedPrice: 0,
            reason: 'invalid',
          },
        ],
      }),
    ).rejects.toThrow('proposal.proposedPrice must be a positive number')
  })

  it('returns accumulated decisions for all proposals', async () => {
    const { ctx } = createCtx()
    const result = await runPriceSentinel(ctx, {
      proposals: [
        {
          productId: 'p-1',
          currentPrice: 100,
          proposedPrice: 110,
          reason: 'small move',
        },
        {
          productId: 'p-2',
          currentPrice: 100,
          proposedPrice: 130,
          reason: 'large move',
        },
      ],
    })
    expect(result.decisions).toHaveLength(2)
    expect(result.decisions[0]?.productId).toBe('p-1')
    expect(result.decisions[1]?.productId).toBe('p-2')
  })

  describe('HarnessError handling — Constitution §2.3 + §4.3', () => {
    it('catches HarnessError from updatePrice and logs harness_error without crashing', async () => {
      const { ctx, harness } = createCtx()
      vi.mocked(harness.updatePrice).mockRejectedValue(
        new HarnessError('shopify', '429', 'rate limited'),
      )
      const result = await runPriceSentinel(ctx, {
        proposals: [{ productId: 'p-1', currentPrice: 100, proposedPrice: 110, reason: 'small move' }],
      })
      expect(result.decisions).toHaveLength(1)
      expect(ctx.logAction).toHaveBeenCalledWith(
        'price_sentinel.harness_error',
        expect.objectContaining({ type: 'harness_error', code: '429', productId: 'p-1' }),
      )
      expect(ctx.logAction).not.toHaveBeenCalledWith('price_sentinel.price_updated', expect.anything())
    })

    it('continues to process subsequent proposals after a HarnessError', async () => {
      const { ctx, harness } = createCtx()
      vi.mocked(harness.updatePrice)
        .mockRejectedValueOnce(new HarnessError('shopify', '429', 'rate limited'))
        .mockResolvedValueOnce(undefined)
      const result = await runPriceSentinel(ctx, {
        proposals: [
          { productId: 'p-1', currentPrice: 100, proposedPrice: 110, reason: 'first — fails' },
          { productId: 'p-2', currentPrice: 100, proposedPrice: 105, reason: 'second — succeeds' },
        ],
      })
      expect(result.decisions).toHaveLength(2)
      expect(harness.updatePrice).toHaveBeenCalledTimes(2)
      expect(ctx.logAction).toHaveBeenCalledWith('price_sentinel.price_updated', expect.objectContaining({ decision: expect.objectContaining({ productId: 'p-2' }) }))
    })

    it('catches generic Error from updatePrice and logs with code=unknown', async () => {
      const { ctx, harness } = createCtx()
      vi.mocked(harness.updatePrice).mockRejectedValue(new Error('network timeout'))
      await runPriceSentinel(ctx, {
        proposals: [{ productId: 'p-1', currentPrice: 100, proposedPrice: 110, reason: 'any' }],
      })
      expect(ctx.logAction).toHaveBeenCalledWith(
        'price_sentinel.harness_error',
        expect.objectContaining({ code: 'unknown', message: 'network timeout' }),
      )
    })
  })
})

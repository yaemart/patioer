import { describe, expect, it, vi } from 'vitest'
import type { TenantHarness } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import { runPriceSentinel } from './price-sentinel.agent.js'

function createHarnessMock(): TenantHarness {
  return {
    tenantId: 'tenant-a',
    platformId: 'shopify',
    getProducts: vi.fn().mockResolvedValue([]),
    updatePrice: vi.fn().mockResolvedValue(undefined),
    updateInventory: vi.fn().mockResolvedValue(undefined),
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
    getHarness: () => harness,
    llm: vi.fn().mockResolvedValue({ text: 'ok' }),
    budget: {
      isExceeded: vi.fn().mockResolvedValue(overrides?.budgetExceeded ?? false),
    },
    logAction,
    requestApproval,
    createTicket,
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
})

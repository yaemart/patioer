import { describe, expect, it, vi } from 'vitest'
import { HarnessError } from '@patioer/harness'
import type { TenantHarness } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import { runPriceSentinel } from './price-sentinel.agent.js'
import { createHarnessMock, createDataOsMock } from './test-helpers.js'

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

  describe('DataOS degradation — ADR-03 / AC-P3-19', () => {
    const smallProposal = { productId: 'p-1', currentPrice: 100, proposedPrice: 105, reason: 'small' }

    it('processes proposals without dataOS (ctx.dataOS = undefined)', async () => {
      const { ctx, harness } = createCtx()
      const result = await runPriceSentinel(ctx, { proposals: [smallProposal] })

      expect(result.decisions).toHaveLength(1)
      expect(harness.updatePrice).toHaveBeenCalledWith('p-1', 105)
    })

    it('still updates price when dataOS.recordMemory throws', async () => {
      const { ctx, harness } = createCtx()
      const dataOS = createDataOsMock()
      vi.mocked(dataOS.recordMemory).mockRejectedValue(new Error('write failed'))
      ctx.dataOS = dataOS

      const result = await runPriceSentinel(ctx, { proposals: [smallProposal] })

      expect(result.decisions).toHaveLength(1)
      expect(harness.updatePrice).toHaveBeenCalled()
      expect(ctx.logAction).toHaveBeenCalledWith('price_sentinel.dataos_write_failed', expect.objectContaining({ productId: 'p-1' }))
    })

    it('still updates price when dataOS.recordLakeEvent throws', async () => {
      const { ctx, harness } = createCtx()
      const dataOS = createDataOsMock()
      vi.mocked(dataOS.recordLakeEvent).mockRejectedValue(new Error('write failed'))
      ctx.dataOS = dataOS

      const result = await runPriceSentinel(ctx, { proposals: [smallProposal] })

      expect(result.decisions).toHaveLength(1)
      expect(harness.updatePrice).toHaveBeenCalled()
    })

    it('still updates price when dataOS.recordPriceEvent throws', async () => {
      const { ctx, harness } = createCtx()
      const dataOS = createDataOsMock()
      vi.mocked(dataOS.recordPriceEvent).mockRejectedValue(new Error('write failed'))
      ctx.dataOS = dataOS

      const result = await runPriceSentinel(ctx, { proposals: [smallProposal] })

      expect(result.decisions).toHaveLength(1)
      expect(harness.updatePrice).toHaveBeenCalled()
    })
  })

  describe('adaptive threshold (AN-FIX-02 / AC-P3-14)', () => {
    it('tightens threshold for high-converting product (conv_rate_7d ≥ 5%) — previously safe change needs approval', async () => {
      const { ctx, harness } = createCtx()
      const dataOS = createDataOsMock({ features: { conv_rate_7d: '0.08' } })
      ctx.dataOS = dataOS
      // base=15%, adapted=10% → +12% delta (>10) should now require approval
      const result = await runPriceSentinel(ctx, {
        proposals: [{ productId: 'p-1', currentPrice: 100, proposedPrice: 112, reason: 'small bump' }],
      })
      expect(result.decisions[0]?.requiresApproval).toBe(true)
      expect(harness.updatePrice).not.toHaveBeenCalled()
      expect(ctx.logAction).toHaveBeenCalledWith(
        'price_sentinel.threshold_adapted',
        expect.objectContaining({ adaptedThreshold: 10, conv_rate_7d: 0.08 }),
      )
    })

    it('loosens threshold for low-converting product (conv_rate_7d ≤ 1%) — previously approval-required becomes auto', async () => {
      const { ctx, harness } = createCtx()
      const dataOS = createDataOsMock({ features: { conv_rate_7d: '0.005' } })
      ctx.dataOS = dataOS
      // base=15%, adapted=20% → +16% delta (<20) should now be auto-approved
      const result = await runPriceSentinel(ctx, {
        proposals: [{ productId: 'p-1', currentPrice: 100, proposedPrice: 116, reason: 'discount' }],
      })
      expect(result.decisions[0]?.requiresApproval).toBe(false)
      expect(harness.updatePrice).toHaveBeenCalledWith('p-1', 116)
      expect(ctx.logAction).toHaveBeenCalledWith(
        'price_sentinel.threshold_adapted',
        expect.objectContaining({ adaptedThreshold: 20, conv_rate_7d: 0.005 }),
      )
    })

    it('keeps base threshold when conv_rate_7d is in normal range (1–5%)', async () => {
      const { ctx } = createCtx()
      const dataOS = createDataOsMock({ features: { conv_rate_7d: '0.03' } })
      ctx.dataOS = dataOS
      await runPriceSentinel(ctx, {
        proposals: [{ productId: 'p-1', currentPrice: 100, proposedPrice: 110, reason: 'test' }],
      })
      expect(ctx.logAction).not.toHaveBeenCalledWith('price_sentinel.threshold_adapted', expect.anything())
    })

    it('uses base threshold and logs degraded when getFeatures throws', async () => {
      const { ctx, harness } = createCtx()
      const dataOS = createDataOsMock()
      vi.mocked(dataOS.getFeatures).mockRejectedValue(new Error('DataOS unreachable'))
      ctx.dataOS = dataOS
      // +12% delta with base threshold (15%) → should auto-approve
      const result = await runPriceSentinel(ctx, {
        proposals: [{ productId: 'p-1', currentPrice: 100, proposedPrice: 112, reason: 'test' }],
      })
      expect(result.decisions[0]?.requiresApproval).toBe(false)
      expect(harness.updatePrice).toHaveBeenCalled()
      expect(ctx.logAction).toHaveBeenCalledWith(
        'price_sentinel.dataos_degraded',
        expect.objectContaining({ productId: 'p-1', op: 'getFeatures' }),
      )
    })

    it('uses base threshold when feature row has no conv_rate_7d field', async () => {
      const { ctx, harness } = createCtx()
      const dataOS = createDataOsMock({ features: { price_current: '99.00' } })
      ctx.dataOS = dataOS
      const result = await runPriceSentinel(ctx, {
        proposals: [{ productId: 'p-1', currentPrice: 100, proposedPrice: 112, reason: 'test' }],
      })
      expect(result.decisions[0]?.requiresApproval).toBe(false)
      expect(harness.updatePrice).toHaveBeenCalled()
      expect(ctx.logAction).not.toHaveBeenCalledWith('price_sentinel.threshold_adapted', expect.anything())
    })
  })
})

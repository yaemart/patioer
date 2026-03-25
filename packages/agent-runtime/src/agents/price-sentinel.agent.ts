import type { AgentContext } from '../context.js'
import type { PriceDecision, PriceSentinelRunInput } from '../types.js'

const DEFAULT_APPROVAL_THRESHOLD_PERCENT = 15

function calcDeltaPercent(currentPrice: number, proposedPrice: number): number {
  return ((proposedPrice - currentPrice) / currentPrice) * 100
}

function assertValidProposal(proposal: {
  productId: string
  currentPrice: number
  proposedPrice: number
  reason: string
}): void {
  if (!proposal.productId) throw new Error('proposal.productId is required')
  if (!Number.isFinite(proposal.currentPrice) || proposal.currentPrice <= 0) {
    throw new Error('proposal.currentPrice must be a positive number')
  }
  if (!Number.isFinite(proposal.proposedPrice) || proposal.proposedPrice <= 0) {
    throw new Error('proposal.proposedPrice must be a positive number')
  }
  if (!proposal.reason) throw new Error('proposal.reason is required')
}

function buildDecision(
  productId: string,
  currentPrice: number,
  proposedPrice: number,
  reason: string,
  threshold: number,
): PriceDecision {
  const deltaPercent = calcDeltaPercent(currentPrice, proposedPrice)
  const requiresApproval = Math.abs(deltaPercent) > threshold
  return {
    productId,
    currentPrice,
    proposedPrice,
    deltaPercent,
    requiresApproval,
    reason,
  }
}

export async function runPriceSentinel(
  ctx: AgentContext,
  input: PriceSentinelRunInput,
): Promise<{ decisions: PriceDecision[] }> {
  const raw = input.approvalThresholdPercent ?? DEFAULT_APPROVAL_THRESHOLD_PERCENT
  const threshold = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_APPROVAL_THRESHOLD_PERCENT
  await ctx.logAction('price_sentinel.run.started', {
    proposalCount: input.proposals.length,
    threshold,
  })

  if (await ctx.budget.isExceeded()) {
    await ctx.logAction('price_sentinel.budget_exceeded', {
      proposalCount: input.proposals.length,
    })
    return { decisions: [] }
  }

  const decisions: PriceDecision[] = []
  const platform = ctx.getEnabledPlatforms()[0] ?? 'shopify'

  for (const proposal of input.proposals) {
    assertValidProposal(proposal)
    let features: unknown = null
    if (ctx.dataOS) {
      try {
        features = await ctx.dataOS.getFeatures(platform, proposal.productId)
        const memories =
          (await ctx.dataOS.recallMemory('price-sentinel', {
            product: proposal,
            features,
          })) ?? []
        await ctx.logAction('price_sentinel.dataos_context', {
          productId: proposal.productId,
          features,
          memories,
        })
      } catch {
        await ctx.logAction('price_sentinel.dataos_degraded', { productId: proposal.productId })
      }
    }

    const decision = buildDecision(
      proposal.productId,
      proposal.currentPrice,
      proposal.proposedPrice,
      proposal.reason,
      threshold,
    )
    decisions.push(decision)

    if (decision.requiresApproval) {
      await ctx.requestApproval({
        action: 'price.update',
        payload: decision,
        reason: `price delta ${decision.deltaPercent.toFixed(2)}% exceeds ${threshold}% threshold`,
      })
      await ctx.logAction('price_sentinel.approval_requested', { decision })
      continue
    }

    await ctx.getHarness().updatePrice(decision.productId, decision.proposedPrice)
    await ctx.logAction('price_sentinel.price_updated', { decision })

    if (ctx.dataOS) {
      try {
        await ctx.dataOS.recordMemory({
          agentId: 'price-sentinel',
          entityId: proposal.productId,
          context: { product: proposal, features },
          action: {
            newPrice: decision.proposedPrice,
            reason: decision.reason,
          },
        })
        await ctx.dataOS.recordLakeEvent({
          agentId: ctx.agentId,
          eventType: 'price_changed',
          entityId: proposal.productId,
          payload: decision,
          metadata: { agentType: 'price-sentinel' },
        })
        await ctx.dataOS.recordPriceEvent({
          productId: proposal.productId,
          priceBefore: decision.currentPrice,
          priceAfter: decision.proposedPrice,
          changePct: decision.deltaPercent,
          approved: false,
        })
      } catch {
        await ctx.logAction('price_sentinel.dataos_write_failed', { productId: proposal.productId })
      }
    }
  }

  await ctx.logAction('price_sentinel.run.completed', {
    proposalCount: input.proposals.length,
    decisionCount: decisions.length,
  })

  return { decisions }
}

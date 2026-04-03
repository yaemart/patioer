import { HarnessError } from '@patioer/harness'
import type { AgentContext } from '../context.js'
import type { PendingApprovalItem } from '../ports.js'
import type { PriceDecision, PriceSentinelRunInput } from '../commerce-types.js'
import { errorMessage } from '../error-message.js'
import {
  composeGuardedReason,
  guardRequiresApproval,
  requireApprovalGuard,
  type BusinessGuard,
} from './business-guard.js'
import { runAgentPreflight } from './preflight.js'

const DEFAULT_APPROVAL_THRESHOLD_PERCENT = 15

function calcDeltaPercent(currentPrice: number, proposedPrice: number): number {
  return ((proposedPrice - currentPrice) / currentPrice) * 100
}

function assertValidProposal(proposal: {
  productId: string
  platform?: string
  currentPrice: number
  proposedPrice: number
  reason: string
}): void {
  if (!proposal.productId) throw new Error('proposal.productId is required')
  if (proposal.platform !== undefined && !proposal.platform) {
    throw new Error('proposal.platform must be a non-empty string when provided')
  }
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
  platform: string | undefined,
  currentPrice: number,
  proposedPrice: number,
  reason: string,
  threshold: number,
): PriceDecision {
  const deltaPercent = calcDeltaPercent(currentPrice, proposedPrice)
  const requiresApproval = Math.abs(deltaPercent) > threshold
  return {
    productId,
    platform,
    currentPrice,
    proposedPrice,
    deltaPercent,
    requiresApproval,
    reason,
  }
}

/**
 * Derive a per-product approval threshold from Feature Store conv_rate_7d.
 * High-converting products are more sensitive to price changes → lower threshold.
 * Returns the base threshold when conv_rate_7d is unavailable.
 *
 * Adaptive rules (Phase 3 AN-FIX-02 / AC-P3-14):
 *  conv_rate_7d ≥ 0.05 (5%) → base − 5pp  (protect top performers)
 *  conv_rate_7d ≤ 0.01 (1%) → base + 5pp  (relax for low performers)
 *  otherwise                → base
 */
function adaptiveThreshold(base: number, convRate7d: number | null): number {
  if (convRate7d === null || !Number.isFinite(convRate7d)) return base
  if (convRate7d >= 0.05) return Math.max(5, base - 5)
  if (convRate7d <= 0.01) return Math.min(30, base + 5)
  return base
}

async function safeDataOsWrite(ctx: AgentContext, productId: string, fn: () => Promise<void>): Promise<void> {
  if (!ctx.dataOS) return
  try {
    await fn()
  } catch (err) {
    await ctx.logAction('price_sentinel.dataos_write_failed', { productId, error: errorMessage(err) })
  }
}

function recentRange(days: number): { from: Date; to: Date } {
  const to = new Date()
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - days)
  return { from, to }
}

async function loadEconomicsContext(
  ctx: AgentContext,
  platform: string,
  productId: string,
): Promise<Record<string, number> | null> {
  if (!ctx.business?.unitEconomics) return null
  try {
    const economics = await ctx.business.unitEconomics.getSkuEconomics(
      platform,
      productId,
      recentRange(30),
    )
    if (!economics) return null

    return {
      grossRevenue30d: economics.grossRevenue,
      contributionMargin30d: economics.contributionMargin,
      unitsSold30d: economics.unitsSold,
      tacos30d: economics.tacos,
    }
  } catch (err) {
    await ctx.logAction('price_sentinel.business_context_degraded', {
      productId,
      platform,
      port: 'unitEconomics',
      error: errorMessage(err),
    })
    return null
  }
}

function requiresBusinessReview(
  proposal: { currentPrice: number; proposedPrice: number },
  economicsContext: Record<string, number> | null,
  hasBusinessPort: boolean,
): BusinessGuard {
  if (!hasBusinessPort) return { effect: 'none', reason: null }

  if (!economicsContext || economicsContext.grossRevenue30d <= 0) {
    return requireApprovalGuard('profit data unavailable — manual review required')
  }

  const isPriceDecrease = proposal.proposedPrice < proposal.currentPrice
  if (isPriceDecrease && economicsContext.contributionMargin30d <= 0) {
    return requireApprovalGuard('negative contribution margin in last 30d — manual review required')
  }

  return { effect: 'none', reason: null }
}

function hasPendingPriceApproval(
  pendingApprovals: PendingApprovalItem[],
  decision: PriceDecision,
): boolean {
  return pendingApprovals.some((item) => {
    if (item.action !== 'price.update') return false
    const payload = (item.payload ?? {}) as Record<string, unknown>
    return (
      payload.productId === decision.productId &&
      payload.platform === decision.platform &&
      Number(payload.proposedPrice) === decision.proposedPrice
    )
  })
}

export async function runPriceSentinel(
  ctx: AgentContext,
  input: PriceSentinelRunInput,
): Promise<{ decisions: PriceDecision[] }> {
  await ctx.logAction('price_sentinel.run.started', {
    proposalCount: input.proposals.length,
    inputThreshold: input.approvalThresholdPercent ?? null,
  })

  const preflight = await runAgentPreflight(ctx, {
    agentKey: 'price_sentinel',
    humanInLoopAction: 'price_sentinel.full_run',
    payload: {
      proposalCount: input.proposals.length,
    },
  })
  if (preflight.reason !== 'continue') {
    return { decisions: [] }
  }

  const raw = input.approvalThresholdPercent ?? preflight.governance.priceChangeThreshold
  const baseThreshold = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_APPROVAL_THRESHOLD_PERCENT

  const decisions: PriceDecision[] = []
  const pendingApprovals = preflight.pendingApprovals
  const defaultPlatform = ctx.getEnabledPlatforms()[0] ?? 'shopify'
  const hasBusinessPort = Boolean(ctx.business?.unitEconomics)

  for (const proposal of input.proposals) {
    assertValidProposal(proposal)
    const platform = proposal.platform ?? defaultPlatform

    // AN-FIX-02: read Feature Store to adaptively tune approval threshold per product.
    // High-converting products get a tighter threshold; low performers get looser.
    let threshold = baseThreshold
    if (ctx.dataOS) {
      try {
        const features = await ctx.dataOS.getFeatures(platform, proposal.productId)
        const convRate = Number(features?.conv_rate_7d)
        threshold = adaptiveThreshold(baseThreshold, Number.isFinite(convRate) ? convRate : null)
        if (threshold !== baseThreshold) {
          await ctx.logAction('price_sentinel.threshold_adapted', {
            productId: proposal.productId,
            baseThreshold,
            adaptedThreshold: threshold,
            conv_rate_7d: convRate,
          })
        }
      } catch {
        await ctx.logAction('price_sentinel.dataos_degraded', { productId: proposal.productId, op: 'getFeatures' })
      }
    }

    const economicsContext = await loadEconomicsContext(ctx, platform, proposal.productId)
    const businessGuard = requiresBusinessReview(proposal, economicsContext, hasBusinessPort)

    const decision = buildDecision(
      proposal.productId,
      platform,
      proposal.currentPrice,
      proposal.proposedPrice,
      proposal.reason,
      threshold,
    )
    decision.requiresApproval = guardRequiresApproval(decision.requiresApproval, businessGuard)
    decisions.push(decision)

    if (decision.requiresApproval) {
      if (businessGuard.reason) {
        await ctx.logAction('price_sentinel.business_guard_applied', {
          productId: proposal.productId,
          platform,
          businessGuardReason: businessGuard.reason,
          economicsContext,
        })
      }
      if (hasPendingPriceApproval(pendingApprovals, decision)) {
        await ctx.logAction('price_sentinel.approval_duplicate_skipped', {
          decision,
          economicsContext,
          businessGuardReason: businessGuard.reason,
          keyword: 'PRICE_UPDATE_PENDING_DEDUPE',
        })
        continue
      }
      await ctx.requestApproval({
        action: 'price.update',
        payload: { ...decision, economicsContext, businessGuardReason: businessGuard.reason },
        reason: composeGuardedReason(
          Math.abs(decision.deltaPercent) > threshold
            ? `price delta ${decision.deltaPercent.toFixed(2)}% exceeds ${threshold}% threshold`
            : '',
          businessGuard,
        ),
      })
      await ctx.logAction('price_sentinel.approval_requested', {
        decision,
        economicsContext,
        businessGuardReason: businessGuard.reason,
      })
      await safeDataOsWrite(ctx, proposal.productId, async () => {
        await ctx.dataOS!.recordLakeEvent({
          platform,
          agentId: ctx.agentId,
          eventType: 'price_change_pending',
          entityId: proposal.productId,
          payload: decision,
          metadata: { agentType: 'price-sentinel', reason: 'approval_required' },
        })
        await ctx.dataOS!.recordPriceEvent({
          platform,
          productId: proposal.productId,
          priceBefore: decision.currentPrice,
          priceAfter: decision.proposedPrice,
          changePct: decision.deltaPercent,
          approved: false,
        })
      })
      continue
    }

    // Constitution §2.3 + §4.3: harness calls must be wrapped; HarnessError (rate-limit,
    // auth-expired, 5xx) is caught, logged as a structured harness_error event, and the
    // proposal is skipped so subsequent proposals can still be processed.
    try {
      await ctx.getHarness(platform).updatePrice(decision.productId, decision.proposedPrice)
    } catch (err) {
      const code = err instanceof HarnessError ? err.code : 'unknown'
      await ctx.logAction('price_sentinel.harness_error', {
        type: 'harness_error',
        platform,
        code,
        productId: proposal.productId,
        economicsContext,
        message: errorMessage(err),
      })
      continue
    }
    await ctx.logAction('price_sentinel.price_updated', { decision, economicsContext })

    await safeDataOsWrite(ctx, proposal.productId, async () => {
      const decisionId = await ctx.dataOS!.recordMemory({
        agentId: 'price-sentinel',
        platform,
        entityId: proposal.productId,
        context: { product: proposal },
        action: {
          newPrice: decision.proposedPrice,
          reason: decision.reason,
        },
      })
      // recall() only returns memories where outcome IS NOT NULL, so write immediately.
      if (decisionId) {
        await ctx.dataOS!.writeOutcome(decisionId, {
          applied: true,
          actualPrice: decision.proposedPrice,
          appliedAt: new Date().toISOString(),
        })
      }
      await ctx.dataOS!.recordLakeEvent({
        platform,
        agentId: ctx.agentId,
        eventType: 'price_changed',
        entityId: proposal.productId,
        payload: decision,
        metadata: { agentType: 'price-sentinel' },
      })
      await ctx.dataOS!.recordPriceEvent({
        platform,
        productId: proposal.productId,
        priceBefore: decision.currentPrice,
        priceAfter: decision.proposedPrice,
        changePct: decision.deltaPercent,
        approved: true,
      })
    })
  }

  await ctx.logAction('price_sentinel.run.completed', {
    proposalCount: input.proposals.length,
    decisionCount: decisions.length,
  })

  return { decisions }
}

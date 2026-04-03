import { HarnessError } from '@patioer/harness'
import type {
  DecisionPipeline,
  GovernedDecision,
} from '../decision-pipeline.js'
import { NO_DEGRADATION } from '../decision-pipeline.js'
import { detectDegradation, applyDegradation } from '../decision-degradation.js'
import { errorMessage } from '../error-message.js'
import { buildPromptStack, flattenPromptStack } from '../prompt-stack.js'
import { runAgentPreflight } from './preflight.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PriceSentinelInput {
  platforms?: string[]
  minMarginPercent?: number
}

export interface PriceProposal {
  productId: string
  platform: string
  currentPrice: number
  proposedPrice: number
  action: 'hold' | 'adjust'
  reason: string
  confidence: number
  expectedMarginDelta: number
}

// ---------------------------------------------------------------------------
// LLM prompt + parser
// ---------------------------------------------------------------------------

function buildReasoningPrompt(
  products: Array<{ productId: string; platform: string; currentPrice: number; economics: Record<string, number> | null; competitorPrices?: number[]; pastDecision?: Record<string, unknown> | null }>,
  goalContext: Record<string, unknown> | null,
): string {
  const productsJson = JSON.stringify(products.map((p) => ({
    productId: p.productId,
    platform: p.platform,
    currentPrice: p.currentPrice,
    economics: p.economics,
    competitorPrices: p.competitorPrices ?? [],
    pastDecision: p.pastDecision ?? null,
  })))

  const goalSection = goalContext
    ? `\nOPERATING CONTEXT:\n${JSON.stringify(goalContext)}\n`
    : ''

  return `Analyze these products and recommend pricing actions.
${goalSection}
PRODUCTS:
${productsJson}

Each product may include a "pastDecision" field with the last pricing decision and its outcome.
Use this history to inform your recommendations — avoid repeating actions that produced poor results.

For each product, output a JSON object with:
- productId (string)
- action ("hold" or "adjust")
- proposedPrice (number, same as currentPrice if hold)
- reason (string, 1-2 sentences in business language; reference past decision outcome when relevant)
- confidence (number 0-1)
- expectedMarginDelta (number, estimated percentage point change in contribution margin)

Respond ONLY with a JSON array. No other text.`
}

function parseReasoningResponse(text: string, products: Array<{ productId: string; platform: string; currentPrice: number }>): PriceProposal[] {
  let parsed: unknown[]
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    parsed = JSON.parse(jsonMatch?.[0] ?? '[]') as unknown[]
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) return []

  const productMap = new Map(products.map((p) => [p.productId, p]))

  return parsed
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => {
      const pid = String(item.productId ?? '')
      const product = productMap.get(pid)
      if (!product) return null

      const action = item.action === 'hold' ? 'hold' : 'adjust'
      const proposedPrice = action === 'hold'
        ? product.currentPrice
        : (typeof item.proposedPrice === 'number' && item.proposedPrice > 0 ? item.proposedPrice : product.currentPrice)

      return {
        productId: pid,
        platform: product.platform,
        currentPrice: product.currentPrice,
        proposedPrice,
        action,
        reason: typeof item.reason === 'string' ? item.reason : 'No reason provided',
        confidence: typeof item.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : 0.5,
        expectedMarginDelta: typeof item.expectedMarginDelta === 'number' ? item.expectedMarginDelta : 0,
      } satisfies PriceProposal
    })
    .filter((p): p is PriceProposal => p !== null)
}

// ---------------------------------------------------------------------------
// Pipeline implementation
// ---------------------------------------------------------------------------

export const priceSentinelPipeline: DecisionPipeline<PriceSentinelInput, PriceProposal> = {
  scope: 'price-sentinel',

  async gather(ctx, input) {
    const preflight = await runAgentPreflight(ctx, {
      agentKey: 'price_sentinel',
      humanInLoopAction: 'price_sentinel.full_run',
    })
    if (preflight.reason !== 'continue') {
      return {
        governance: preflight.governance,
        sopGoalContext: null,
        sopSystemPrompt: null,
        degradation: { ...NO_DEGRADATION },
        platformData: { preflight: preflight.reason },
      }
    }

    const governance = await ctx.getEffectiveGovernance('price-sentinel')

    const sop = await ctx.getActiveSop('price-sentinel')

    const platforms = input.platforms ?? ctx.getEnabledPlatforms()
    const degradation = await detectDegradation(ctx, {
      scope: 'price-sentinel',
      platform: platforms[0],
    })

    const products: Array<{
      productId: string
      platform: string
      currentPrice: number
      economics: Record<string, number> | null
      competitorPrices?: number[]
      pastDecision?: Record<string, unknown> | null
    }> = []

    for (const platform of platforms) {
      try {
        const harness = ctx.getHarness(platform)
        const page = await harness.getProductsPage({ limit: 50 })
        for (const product of page.items) {
          if (!product.price || product.price <= 0) continue

          let economics: Record<string, number> | null = null
          if (ctx.business?.unitEconomics) {
            const now = new Date()
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000)
            try {
              const sku = await ctx.business.unitEconomics.getSkuEconomics(
                platform,
                product.id,
                { from: thirtyDaysAgo, to: now },
              )
              if (sku) {
                economics = {
                  grossRevenue30d: sku.grossRevenue,
                  contributionMargin30d: sku.contributionMargin,
                  unitsSold30d: sku.unitsSold,
                  tacos30d: sku.tacos,
                }
              }
            } catch {
              /* degrade: no economics for this product */
            }
          }

          let competitorPrices: number[] | undefined
          if (ctx.dataOS) {
            try {
              const features = await ctx.dataOS.getFeatures(platform, product.id)
              if (features?.competitor_prices) {
                competitorPrices = (Array.isArray(features.competitor_prices)
                  ? features.competitor_prices
                  : []
                ).filter((p): p is number => typeof p === 'number')
              }
            } catch {
              /* degrade: no competitor data */
            }
          }

          let pastDecision: Record<string, unknown> | null = null
          if (ctx.dataOS) {
            try {
              const memory = await ctx.dataOS.recallMemory('price-sentinel', { productId: product.id })
              if (memory) pastDecision = memory as unknown as Record<string, unknown>
            } catch { /* memory recall degradation */ }
          }

          products.push({
            productId: product.id,
            platform,
            currentPrice: product.price,
            economics,
            competitorPrices,
            pastDecision,
          })
        }
      } catch (err) {
        await ctx.logAction('price_sentinel.gather_error', {
          platform,
          error: errorMessage(err),
        })
      }
    }

    return {
      governance,
      sopGoalContext: sop?.extractedGoalContext ?? null,
      sopSystemPrompt: sop?.extractedSystemPrompt ?? null,
      degradation,
      platformData: {
        products,
        pendingApprovals: preflight.pendingApprovals,
        minMarginPercent: input.minMarginPercent ?? 0,
      },
    }
  },

  async reason(ctx, context, _input) {
    const products = (context.platformData.products ?? []) as Array<{
      productId: string
      platform: string
      currentPrice: number
      economics: Record<string, number> | null
      competitorPrices?: number[]
      pastDecision?: Record<string, unknown> | null
    }>

    if (products.length === 0) return []
    if (context.platformData.preflight) return []

    const sopForPrompt = context.sopSystemPrompt
      ? { extractedSystemPrompt: context.sopSystemPrompt, extractedGoalContext: context.sopGoalContext }
      : null

    const stack = buildPromptStack(ctx, sopForPrompt)
    const taskPrompt = buildReasoningPrompt(products, context.sopGoalContext)
    const { systemPrompt, prompt } = flattenPromptStack(stack, taskPrompt)

    const response = await ctx.llm({ systemPrompt, prompt })

    return parseReasoningResponse(response.text, products)
  },

  async govern(ctx, decisions, context) {
    const threshold = context.governance.priceChangeThreshold
    const minMarginPct = (context.platformData.minMarginPercent ?? 0) as number
    const governed: GovernedDecision<PriceProposal>[] = []

    for (const decision of decisions) {
      if (decision.action === 'hold') {
        governed.push({
          decision,
          action: 'auto_execute',
          reason: 'No price change recommended',
          confidence: decision.confidence,
          guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: false },
        })
        continue
      }

      const deltaPercent = ((decision.proposedPrice - decision.currentPrice) / decision.currentPrice) * 100
      let action: 'auto_execute' | 'requires_approval' = 'auto_execute'
      let reason = `Price change ${deltaPercent.toFixed(1)}% within ${threshold}% threshold`
      let constitutionTriggered = false
      let businessGuardTriggered = false

      if (Math.abs(deltaPercent) > threshold) {
        action = 'requires_approval'
        reason = `${decision.reason} — price delta ${deltaPercent.toFixed(1)}% exceeds ${threshold}% threshold`
        constitutionTriggered = true
      }

      const products = (context.platformData.products ?? []) as Array<{ productId: string; economics: Record<string, number> | null }>
      const productData = products.find((p) => p.productId === decision.productId)
      if (productData?.economics) {
        const { grossRevenue30d, contributionMargin30d } = productData.economics
        if (contributionMargin30d <= 0 && decision.proposedPrice < decision.currentPrice) {
          action = 'requires_approval'
          reason = `${decision.reason} — negative margin, price decrease needs review`
          businessGuardTriggered = true
        }
        if (minMarginPct > 0 && grossRevenue30d > 0) {
          const currentMarginPct = (contributionMargin30d / grossRevenue30d) * 100
          const projectedMarginPct = currentMarginPct + decision.expectedMarginDelta
          if (projectedMarginPct < minMarginPct) {
            action = 'requires_approval'
            reason = `${decision.reason} — projected margin ${projectedMarginPct.toFixed(1)}% below ${minMarginPct}% minimum`
            businessGuardTriggered = true
          }
        }
      } else if (context.degradation.profitDataMissing) {
        businessGuardTriggered = true
      }

      const degraded = applyDegradation('price-sentinel', action, context.degradation)
      const finalAction = degraded.action as typeof action | 'degraded_suggest_only' | 'blocked'

      governed.push({
        decision,
        action: finalAction,
        reason: degraded.reasons.length > 0 ? `${reason}; ${degraded.reasons.join('; ')}` : reason,
        confidence: decision.confidence,
        guard: {
          degraded: degraded.reasons.length > 0,
          constitutionTriggered,
          businessGuardTriggered,
        },
      })
    }

    return governed
  },

  async execute(ctx, governed, context) {
    let executedCount = 0
    let approvalCount = 0
    let blockedCount = 0
    let degradedCount = 0

    const pendingApprovals = (context.platformData.pendingApprovals ?? []) as Array<{ action: string; payload: unknown }>

    for (const g of governed) {
      if (g.decision.action === 'hold') continue

      switch (g.action) {
        case 'blocked':
          blockedCount++
          await ctx.logAction('price_sentinel.blocked', {
            productId: g.decision.productId,
            reason: g.reason,
          })
          break

        case 'degraded_suggest_only':
          degradedCount++
          await ctx.logAction('price_sentinel.suggestion', {
            productId: g.decision.productId,
            proposedPrice: g.decision.proposedPrice,
            reason: g.reason,
            confidence: g.confidence,
          })
          break

        case 'requires_approval': {
          const isDuplicate = pendingApprovals.some((a) => {
            if (a.action !== 'price.update') return false
            const p = (a.payload ?? {}) as Record<string, unknown>
            return p.productId === g.decision.productId && Number(p.proposedPrice) === g.decision.proposedPrice
          })
          if (isDuplicate) {
            await ctx.logAction('price_sentinel.approval_duplicate_skipped', { productId: g.decision.productId })
            break
          }
          approvalCount++
          await ctx.requestApproval({
            action: 'price.update',
            payload: {
              productId: g.decision.productId,
              platform: g.decision.platform,
              currentPrice: g.decision.currentPrice,
              proposedPrice: g.decision.proposedPrice,
              deltaPercent: ((g.decision.proposedPrice - g.decision.currentPrice) / g.decision.currentPrice) * 100,
              confidence: g.confidence,
              expectedMarginDelta: g.decision.expectedMarginDelta,
              displayTitle: `Adjust ${g.decision.productId} price to $${g.decision.proposedPrice.toFixed(2)}`,
              impactPreview: g.decision.reason,
              rollbackPlan: `Revert to $${g.decision.currentPrice.toFixed(2)}`,
            },
            reason: g.reason,
          })
          break
        }

        case 'auto_execute': {
          try {
            await ctx.getHarness(g.decision.platform).updatePrice(g.decision.productId, g.decision.proposedPrice)
            executedCount++
            await ctx.logAction('price_sentinel.price_updated', {
              productId: g.decision.productId,
              platform: g.decision.platform,
              oldPrice: g.decision.currentPrice,
              newPrice: g.decision.proposedPrice,
              confidence: g.confidence,
            })

            if (ctx.dataOS) {
              try {
                const memId = await ctx.dataOS.recordMemory({
                  agentId: 'price-sentinel',
                  platform: g.decision.platform,
                  entityId: g.decision.productId,
                  context: { currentPrice: g.decision.currentPrice, economics: null },
                  action: { newPrice: g.decision.proposedPrice, reason: g.decision.reason },
                })
                if (memId) {
                  await ctx.dataOS.writeOutcome(memId, {
                    applied: true,
                    actualPrice: g.decision.proposedPrice,
                    appliedAt: new Date().toISOString(),
                  })
                }
              } catch {
                /* DataOS write degradation — non-fatal */
              }
            }
          } catch (err) {
            const code = err instanceof HarnessError ? err.code : 'unknown'
            await ctx.logAction('price_sentinel.harness_error', {
              type: 'harness_error',
              platform: g.decision.platform,
              code,
              productId: g.decision.productId,
              message: errorMessage(err),
            })
          }
          break
        }
      }
    }

    return { decisions: governed, executedCount, approvalCount, blockedCount, degradedCount }
  },

  async remember(ctx, result, _context) {
    if (!ctx.dataOS) return

    for (const g of result.decisions) {
      if (g.decision.action === 'hold') continue
      try {
        await ctx.dataOS.recordLakeEvent({
          platform: g.decision.platform,
          agentId: ctx.agentId,
          eventType: g.action === 'auto_execute' ? 'price_changed' : 'price_change_pending',
          entityId: g.decision.productId,
          payload: {
            currentPrice: g.decision.currentPrice,
            proposedPrice: g.decision.proposedPrice,
            action: g.action,
            confidence: g.confidence,
          },
          metadata: { agentType: 'price-sentinel', scenarioId: null },
        })
      } catch {
        /* lake write degradation — non-fatal */
      }
    }
  },
}

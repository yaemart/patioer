/**
 * Outcome Tracker — delayed evaluation of agent decisions.
 *
 * Each evaluator checks the business impact of a past decision after a
 * configurable delay (typically 7-14 days). Results are written back via
 * DataOsPort.writeOutcome() so they become part of the agent's memory
 * and can be surfaced in dashboards / approval UIs.
 *
 * NOTE: Current evaluators are stubs — they extract metrics from the
 * decision payload but cannot yet compare against post-decision data.
 * All return verdict 'insufficient_data' until real evaluation is wired.
 */

export interface OutcomeResult {
  scope: string
  decisionId: string
  tenantId: string
  evaluatedAt: string
  verdict: 'positive' | 'negative' | 'neutral' | 'insufficient_data'
  metrics: Record<string, number | string | null>
  summary: string
}

export interface OutcomeEvaluator {
  scope: string
  evaluateDelayDays: number
  evaluate(
    decisionId: string,
    tenantId: string,
    decisionPayload: Record<string, unknown>,
  ): Promise<OutcomeResult>
}

function stubEvaluator(
  scope: string,
  evaluateDelayDays: number,
  extractMetrics: (payload: Record<string, unknown>) => { metrics: Record<string, number | string | null>; summary: string },
): OutcomeEvaluator {
  return {
    scope,
    evaluateDelayDays,
    async evaluate(decisionId, tenantId, payload) {
      const { metrics, summary } = extractMetrics(payload)
      return {
        scope,
        decisionId,
        tenantId,
        evaluatedAt: new Date().toISOString(),
        verdict: 'insufficient_data',
        metrics,
        summary: `[stub] ${summary}`,
      }
    },
  }
}

export const priceOutcomeEvaluator = stubEvaluator('price-sentinel', 7, (payload) => {
  const productId = String(payload.productId ?? 'unknown')
  const priceBefore = Number(payload.currentPrice ?? 0)
  const priceAfter = Number(payload.proposedPrice ?? 0)
  const changePct = priceBefore > 0 ? ((priceAfter - priceBefore) / priceBefore) * 100 : 0
  return {
    metrics: { productId, priceBefore, priceAfter, changePct: Math.round(changePct * 100) / 100 },
    summary: `Price ${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}% on ${productId}`,
  }
})

export const adsOutcomeEvaluator = stubEvaluator('ads-optimizer', 7, (payload) => {
  const campaignId = String(payload.campaignId ?? 'unknown')
  const budgetBefore = Number(payload.currentDailyBudget ?? 0)
  const budgetAfter = Number(payload.proposedDailyBudget ?? 0)
  const action = String(payload.action ?? 'unknown')
  return {
    metrics: { campaignId, action, budgetBefore, budgetAfter },
    summary: `Ads ${action} on campaign ${campaignId}: $${budgetBefore} -> $${budgetAfter}`,
  }
})

export const inventoryOutcomeEvaluator = stubEvaluator('inventory-guard', 14, (payload) => {
  const productId = String(payload.productId ?? 'unknown')
  const restockUnits = Number(payload.restockUnits ?? 0)
  const action = String(payload.action ?? 'restock')
  return {
    metrics: { productId, restockUnits, action },
    summary: `Inventory ${action} for ${productId}: ${restockUnits} units`,
  }
})

export const approvalOutcomeEvaluator = stubEvaluator('approval', 7, (payload) => {
  const status = String(payload.status ?? 'unknown')
  const guard = String(payload.guard ?? 'unknown')
  return {
    metrics: {
      status,
      guard,
      resolvedWithinHours: payload.resolvedWithinMs
        ? Math.round(Number(payload.resolvedWithinMs) / 3_600_000 * 10) / 10
        : null,
    },
    summary: `Approval ${status} (${guard})`,
  }
})

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const outcomeEvaluators: OutcomeEvaluator[] = [
  priceOutcomeEvaluator,
  adsOutcomeEvaluator,
  inventoryOutcomeEvaluator,
  approvalOutcomeEvaluator,
]

export function getEvaluator(scope: string): OutcomeEvaluator | undefined {
  return outcomeEvaluators.find((e) => e.scope === scope)
}

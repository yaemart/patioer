import type { DataOsServices } from '@patioer/dataos'
import {
  insightAgentTicks,
  insightAgentOutcomesWritten,
  insightAgentOutcomesFailed,
  insightAgentPendingDecisions,
} from '../metrics.js'

export interface InsightAgentOptions {
  outcomeLookbackDays?: number
  maxDecisionsPerTick?: number
  /** When set, only process decisions belonging to this tenant (Constitution Ch2.5). */
  tenantId?: string
}

export interface InsightReport {
  generatedAt: string
  processed: number
  written: number
  failed: number
  highlights: Array<{
    decisionId: string
    agentId: string
    entityId?: string
    summary: string
  }>
}

export function startInsightAgentInterval(
  services: DataOsServices,
  ms: number,
  opts?: InsightAgentOptions,
): ReturnType<typeof setInterval> {
  let running = false
  return setInterval(() => {
    if (running) return
    running = true
    void _runInsightAgentTick(services, opts ?? {})
      .catch((err) => console.error('[dataos-insight-agent]', err))
      .finally(() => { running = false })
  }, ms)
}

/** @internal Exported for unit testing. */
export async function _runInsightAgentTick(
  services: DataOsServices,
  opts: InsightAgentOptions,
): Promise<{ processed: number; written: number; failed: number }> {
  insightAgentTicks.inc()
  const lookbackDays = opts.outcomeLookbackDays ?? 7
  const maxDecisions = opts.maxDecisionsPerTick ?? 100

  const pending = await services.decisionMemory.listPendingOutcomesOlderThan(
    lookbackDays,
    { limit: maxDecisions, tenantId: opts.tenantId },
  )
  insightAgentPendingDecisions.set(pending.length)

  if (pending.length === 0) {
    return { processed: 0, written: 0, failed: 0 }
  }

  let written = 0
  let failed = 0
  const highlights: InsightReport['highlights'] = []

  for (const decision of pending) {
    try {
      const outcome = await _aggregateOutcome(services, decision)
      await services.decisionMemory.writeOutcome(decision.id, decision.tenant_id, outcome)
      insightAgentOutcomesWritten.inc()
      written++

      if (highlights.length < 10) {
        highlights.push({
          decisionId: decision.id,
          agentId: decision.agent_id,
          entityId: decision.entity_id ?? undefined,
          summary: _summarizeOutcome(decision.agent_id, outcome),
        })
      }
    } catch (err) {
      insightAgentOutcomesFailed.inc()
      failed++
      // Structured error event to Event Lake — provides the same audit-trail as
      // ctx.logAction() for business agents (Constitution §4.3 / §5.3).
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('[dataos-insight-agent] outcome write failed', {
        decisionId: decision.id,
        tenantId: decision.tenant_id,
        error: errorMsg,
      })
      try {
        await services.eventLake.insertEvent({
          tenantId: decision.tenant_id,
          agentId: 'insight-agent',
          eventType: 'outcome_write_failed',
          entityId: decision.id,
          payload: { decisionId: decision.id, agentId: decision.agent_id, error: errorMsg },
          metadata: { workerType: 'insight-agent' },
        })
      } catch {
        // Event Lake write failure must not crash the worker loop.
      }
    }
  }

  const report = _generateInsightReport({
    processed: pending.length,
    written,
    failed,
    highlights,
  })
  console.info('[dataos-insight-agent] report', JSON.stringify(report))

  return { processed: pending.length, written, failed }
}

async function _aggregateOutcome(
  services: DataOsServices,
  decision: {
    tenant_id: string
    agent_id: string
    entity_id: string | null
    decided_at: string
    action: unknown
  },
): Promise<Record<string, unknown>> {
  const decidedAtMs = new Date(decision.decided_at).getTime()
  if (!Number.isFinite(decidedAtMs)) {
    throw new Error(`invalid decided_at: ${decision.decided_at}`)
  }
  const windowEndMs = decidedAtMs + 7 * 24 * 60 * 60 * 1000

  const events = await services.eventLake.queryEvents(decision.tenant_id, {
    entityId: decision.entity_id ?? undefined,
    sinceMs: decidedAtMs,
    limit: 500,
  })

  const eventsInWindow = events.filter((e) => {
    const ts = typeof e.created_at === 'string' ? new Date(e.created_at).getTime() : 0
    return ts >= decidedAtMs && ts <= windowEndMs
  })

  const outcome: Record<string, unknown> = {
    events_after: eventsInWindow.length,
    window_days: 7,
  }

  if (decision.agent_id === 'price-sentinel' && decision.entity_id) {
    const priceEvents = await services.eventLake.queryPriceEvents(decision.tenant_id, {
      productId: decision.entity_id,
      sinceMs: decidedAtMs,
      limit: 100,
    })

    const inWindow = priceEvents.filter((e) => {
      const ts = typeof e.created_at === 'string' ? new Date(e.created_at).getTime() : 0
      return ts >= decidedAtMs && ts <= windowEndMs
    })

    if (inWindow.length > 0) {
      const last = inWindow[0]!
      outcome.conv_rate_7d = Number(last.conv_rate_7d ?? 0)
      outcome.revenue_7d = Number(last.revenue_7d ?? 0)
    }

    const action = decision.action as Record<string, unknown> | null
    if (action) {
      outcome.price_before = action.priceBefore ?? action.price_before
      outcome.price_after = action.newPrice ?? action.price_after
    }
  }

  return outcome
}

function _summarizeOutcome(agentId: string, outcome: Record<string, unknown>): string {
  if (agentId === 'price-sentinel') {
    const before = outcome.price_before ?? '?'
    const after = outcome.price_after ?? '?'
    const conv = outcome.conv_rate_7d ?? '?'
    const rev = outcome.revenue_7d ?? '?'
    return `价格 ${before}→${after}，7天转化率 ${conv}%，营收 ${rev}`
  }
  return `操作完成，后续 ${outcome.events_after ?? 0} 个事件`
}

/** @internal Exported for unit testing. */
export function _generateInsightReport(results: {
  processed: number
  written: number
  failed: number
  highlights: InsightReport['highlights']
}): InsightReport {
  return {
    generatedAt: new Date().toISOString(),
    processed: results.processed,
    written: results.written,
    failed: results.failed,
    highlights: results.highlights.slice(0, 10),
  }
}

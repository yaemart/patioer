import type { DataOsServices } from '@patioer/dataos'
import {
  featureAgentTicks,
  featureAgentItemsProcessed,
  featureAgentBudgetUtilization,
} from '../metrics.js'

export interface FeatureAgentOptions {
  /** Max rows processed per tick (default 500). Excess triggers budget_exceeded (Constitution Ch5.3). */
  maxItemsPerTick?: number
  /** When set, only aggregate events for this tenant (Constitution Ch2.5). */
  tenantId?: string
}

/**
 * Every 15 minutes: aggregate recent price-related events from ClickHouse and refresh Feature Store rows.
 * When ClickHouse is empty, no-op.
 */
export function startFeatureAgentInterval(
  services: DataOsServices,
  ms: number,
  opts?: FeatureAgentOptions,
): ReturnType<typeof setInterval> {
  let running = false
  return setInterval(() => {
    if (running) return
    running = true
    void _runFeatureAgentTick(services, opts ?? {})
      .catch((err) => console.error('[dataos-feature-agent]', err))
      .finally(() => { running = false })
  }, ms)
}

/**
 * @internal Exported for unit testing.
 */
export async function _runFeatureAgentTick(
  services: DataOsServices,
  opts: FeatureAgentOptions,
): Promise<void> {
  featureAgentTicks.inc()
  const maxItems = opts.maxItemsPerTick ?? 500

  const rows = await services.eventLake.aggregateRecentEntityEvents({
    intervalDays: 1,
    limit: maxItems,
    tenantId: opts.tenantId,
  })

  // Constitution Ch4.3 + Ch5.3: structured budget_exceeded report when limit is reached
  if (rows.length >= maxItems) {
    const budgetEvent = {
      type: 'budget_exceeded' as const,
      agentId: 'feature-agent',
      limit: maxItems,
      actual: rows.length,
      message: `Feature Agent batch reached maxItemsPerTick=${maxItems}; processing full returned batch and deferring any additional source rows to later ticks`,
    }
    console.warn('[dataos-feature-agent] budget_exceeded', budgetEvent)
  }

  featureAgentBudgetUtilization.set(Math.min(rows.length / maxItems, 1))

  for (const row of rows) {
    // Harness engineering: skip rows with no platform — 'unknown' is not a valid
    // harness Platform and would pollute the Feature Store with unretrievable keys.
    // aggregateRecentEntityEvents already filters platform='' at the SQL level (Phase 3 fix),
    // but guard here defensively in case older events reach this code path.
    if (!row.platform) continue
    await services.featureStore.upsert({
      tenantId: row.tenant_id,
      platform: row.platform,
      productId: row.product_id,
      convRate7d: Math.min(1, Number(row.evts) / 100),
    })
    featureAgentItemsProcessed.inc()
  }
}

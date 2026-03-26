import { describe, expect, it } from 'vitest'
import {
  featureCacheHits,
  featureCacheMisses,
  lakeEventsInserted,
  ingestionJobsProcessed,
  ingestionJobsFailed,
  featureAgentTicks,
  featureAgentItemsProcessed,
  featureAgentBudgetUtilization,
  renderMetrics,
} from './metrics.js'

describe('metrics', () => {
  it('all counters and gauges are exported', () => {
    expect(featureCacheHits).toBeDefined()
    expect(featureCacheMisses).toBeDefined()
    expect(lakeEventsInserted).toBeDefined()
    expect(ingestionJobsProcessed).toBeDefined()
    expect(ingestionJobsFailed).toBeDefined()
    expect(featureAgentTicks).toBeDefined()
    expect(featureAgentItemsProcessed).toBeDefined()
    expect(featureAgentBudgetUtilization).toBeDefined()
  })

  it('renderMetrics returns prometheus text format', async () => {
    const text = await renderMetrics()
    expect(typeof text).toBe('string')
    expect(text).toContain('dataos_feature_cache_hits_total')
    expect(text).toContain('dataos_lake_events_inserted_total')
  })
})

import { Registry, Counter, Gauge } from 'prom-client'

const registry = new Registry()

export const featureCacheHits = new Counter({
  name: 'dataos_feature_cache_hits_total',
  help: 'Feature Store Redis cache hits',
  registers: [registry],
})

export const featureCacheMisses = new Counter({
  name: 'dataos_feature_cache_misses_total',
  help: 'Feature Store Redis cache misses',
  registers: [registry],
})

export const lakeEventsInserted = new Counter({
  name: 'dataos_lake_events_inserted_total',
  help: 'Events inserted into ClickHouse',
  registers: [registry],
})

export const ingestionJobsProcessed = new Counter({
  name: 'dataos_ingestion_jobs_processed_total',
  help: 'BullMQ ingestion jobs successfully processed',
  registers: [registry],
})

export const ingestionJobsFailed = new Counter({
  name: 'dataos_ingestion_jobs_failed_total',
  help: 'BullMQ ingestion jobs that exhausted all retry attempts (moved to DLQ)',
  registers: [registry],
})

export const featureAgentTicks = new Counter({
  name: 'dataos_feature_agent_ticks_total',
  help: 'Feature Agent tick executions (each 15-min interval)',
  registers: [registry],
})

export const featureAgentItemsProcessed = new Counter({
  name: 'dataos_feature_agent_items_processed_total',
  help: 'Feature rows upserted by Feature Agent per tick',
  registers: [registry],
})

export const featureAgentBudgetUtilization = new Gauge({
  name: 'dataos_feature_agent_budget_utilization',
  help: 'Feature Agent budget utilization ratio (0-1) per tick (Constitution Ch8.1 agent.budget.utilization)',
  registers: [registry],
})


export const insightAgentTicks = new Counter({
  name: 'dataos_insight_agent_ticks_total',
  help: 'Insight Agent tick executions',
  registers: [registry],
})

export const insightAgentOutcomesWritten = new Counter({
  name: 'dataos_insight_agent_outcomes_written_total',
  help: 'Outcomes successfully written by Insight Agent',
  registers: [registry],
})

export const insightAgentOutcomesFailed = new Counter({
  name: 'dataos_insight_agent_outcomes_failed_total',
  help: 'Outcome writes that failed in Insight Agent',
  registers: [registry],
})

export const insightAgentPendingDecisions = new Gauge({
  name: 'dataos_insight_agent_pending_decisions',
  help: 'Pending decisions awaiting outcome at last Insight Agent tick',
  registers: [registry],
})

/**
 * DataOS 内部 API 操作错误计数（Constitution Ch8.1 harness.api.error_rate 等价指标）。
 * label `op`：lake_event / lake_price_event / features_get / features_list /
 *            features_upsert / features_delete / memory_recall / memory_record /
 *            memory_outcome / memory_list / memory_delete / insight_trigger / unknown
 */
export const dataosPortErrors = new Counter({
  name: 'dataos_port_errors_total',
  help: 'DataOS port-level API errors by operation (Constitution Ch8.1)',
  labelNames: ['op'] as const,
  registers: [registry],
})

export async function renderMetrics(): Promise<string> {
  return registry.metrics()
}

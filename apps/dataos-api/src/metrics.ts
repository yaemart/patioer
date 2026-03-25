import { Registry, Counter } from 'prom-client'

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
  help: 'BullMQ ingestion jobs processed',
  registers: [registry],
})

export function getMetricsRegistry(): Registry {
  return registry
}

export async function renderMetrics(): Promise<string> {
  return registry.metrics()
}

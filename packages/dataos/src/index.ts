import { Pool } from 'pg'
import { Redis } from 'ioredis'
import { DecisionMemoryService } from './decision-memory.js'
import { EventLakeService, type EventLakeConfig } from './event-lake.js'
import { FeatureStoreService } from './feature-store.js'
import type { EmbeddingPort } from './embeddings.js'

export * from './types.js'
export * from './event-lake.js'
export * from './feature-store.js'
export * from './decision-memory.js'
export * from './embeddings.js'

export interface DataOsServicesConfig {
  databaseUrl: string
  redisUrl: string
  clickhouse: EventLakeConfig
  /** Injected embedding provider (Harness pattern — no direct OpenAI SDK in this package). */
  embedding?: EmbeddingPort
}

export interface DataOsServices {
  pool: Pool
  redis: Redis
  eventLake: EventLakeService
  featureStore: FeatureStoreService
  decisionMemory: DecisionMemoryService
  shutdown(): Promise<void>
}

export function createDataOsServices(config: DataOsServicesConfig): DataOsServices {
  const pool = new Pool({ connectionString: config.databaseUrl })
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null })
  const eventLake = new EventLakeService(config.clickhouse)
  const featureStore = new FeatureStoreService(pool, redis)
  const decisionMemory = new DecisionMemoryService(pool, config.embedding)

  return {
    pool,
    redis,
    eventLake,
    featureStore,
    decisionMemory,
    async shutdown(): Promise<void> {
      const errors: unknown[] = []
      try { await eventLake.close() } catch (e) { errors.push(e) }
      try { await redis.quit() } catch (e) { errors.push(e) }
      try { await pool.end() } catch (e) { errors.push(e) }
      if (errors.length) {
        console.error('[dataos] partial shutdown errors:', errors)
      }
    },
  }
}

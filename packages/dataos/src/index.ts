import { Pool } from 'pg'
import { Redis } from 'ioredis'
import { DecisionMemoryService } from './decision-memory.js'
import { EventLakeService, type EventLakeConfig } from './event-lake.js'
import { FeatureStoreService } from './feature-store.js'

export * from './types.js'
export * from './event-lake.js'
export * from './feature-store.js'
export * from './decision-memory.js'
export * from './embeddings.js'
export * from './constants.js'

export interface DataOsServicesConfig {
  databaseUrl: string
  redisUrl: string
  clickhouse: EventLakeConfig
  openaiApiKey?: string
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
  const decisionMemory = new DecisionMemoryService(pool, config.openaiApiKey)

  return {
    pool,
    redis,
    eventLake,
    featureStore,
    decisionMemory,
    async shutdown(): Promise<void> {
      await eventLake.close()
      await redis.quit()
      await pool.end()
    },
  }
}

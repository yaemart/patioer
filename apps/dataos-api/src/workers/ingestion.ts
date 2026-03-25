import { Worker } from 'bullmq'
import { DATAOS_LAKE_QUEUE_NAME, type DataOsServices } from '@patioer/dataos'
import { ingestionJobsProcessed } from '../metrics.js'
import type { RedisConnection } from '../redis-url.js'

export const DATAOS_LAKE_QUEUE = DATAOS_LAKE_QUEUE_NAME

export interface LakeIngestJob {
  tenantId: string
  platform?: string
  agentId: string
  eventType: string
  entityId?: string
  payload: unknown
  metadata?: unknown
}

export function startIngestionWorker(
  services: DataOsServices,
  redis: RedisConnection,
): Worker<LakeIngestJob> {
  const worker = new Worker<LakeIngestJob>(
    DATAOS_LAKE_QUEUE_NAME,
    async (job) => {
      const d = job.data
      await services.eventLake.insertEvent({
        tenantId: d.tenantId,
        platform: d.platform,
        agentId: d.agentId,
        eventType: d.eventType,
        entityId: d.entityId,
        payload: d.payload,
        metadata: d.metadata,
      })
      ingestionJobsProcessed.inc()
    },
    {
      connection: {
        host: redis.host,
        port: redis.port,
        password: redis.password,
        db: redis.db,
      },
    },
  )
  worker.on('failed', (job, err) => {
    console.error('[dataos-ingestion] job failed', job?.id, err)
  })
  return worker
}

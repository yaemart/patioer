import { Worker } from 'bullmq'
import { z } from 'zod'
import { DATAOS_LAKE_QUEUE_NAME } from '@patioer/dataos-client'
import type { DataOsServices } from '@patioer/dataos'
import { ingestionJobsProcessed, ingestionJobsFailed } from '../metrics.js'
import type { RedisConnection } from '../redis-url.js'

const INGESTION_MAX_ATTEMPTS = 3

const lakeIngestJobSchema = z.object({
  tenantId: z.string().uuid(),
  platform: z.string().optional(),
  agentId: z.string().min(1),
  eventType: z.string().min(1),
  entityId: z.string().optional(),
  payload: z.unknown(),
  metadata: z.unknown().optional(),
})

type LakeIngestJob = z.infer<typeof lakeIngestJobSchema>

export function startIngestionWorker(
  services: DataOsServices,
  redis: RedisConnection,
): Worker<LakeIngestJob> {
  const worker = new Worker<LakeIngestJob>(
    DATAOS_LAKE_QUEUE_NAME,
    async (job) => {
      const d = lakeIngestJobSchema.parse(job.data)
      await services.eventLake.insertEvent(d)
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
    const isFinal = !job || (job.attemptsMade ?? 0) >= (job.opts?.attempts ?? INGESTION_MAX_ATTEMPTS)
    if (isFinal) ingestionJobsFailed.inc()
    console.error(
      `[dataos-ingestion] job ${job?.id} failed (attempt ${job?.attemptsMade ?? '?'})${isFinal ? ' — moved to DLQ' : ', will retry'}`,
      err,
    )
  })
  return worker
}

import { Queue } from 'bullmq'
import { DATAOS_LAKE_QUEUE_NAME, type DataOsLakeEventPayload } from '@patioer/dataos-client'
import { getRedisClient } from './redis.js'

let _queue: Queue<DataOsLakeEventPayload, void, string> | null = null

function getLakeQueue(): Queue<DataOsLakeEventPayload, void, string> | null {
  if (process.env.DATAOS_LAKE_QUEUE_ENABLED !== '1') {
    return null
  }
  if (!_queue) {
    _queue = new Queue<DataOsLakeEventPayload, void, string>(DATAOS_LAKE_QUEUE_NAME, {
      connection: getRedisClient(),
    })
  }
  return _queue
}

/**
 * Enqueues an Event Lake record for async ClickHouse insert (DataOS Ingestion Agent).
 * No-op when DATAOS_LAKE_QUEUE_ENABLED is not `1` or queue init fails.
 */
export async function enqueueDataOsLakeEvent(payload: DataOsLakeEventPayload): Promise<void> {
  const q = getLakeQueue()
  if (!q) return
  try {
    await q.add('lake', payload, { removeOnComplete: 1000, removeOnFail: 5000 })
  } catch (err) {
    console.warn('[dataos-queue] enqueue failed', err)
  }
}

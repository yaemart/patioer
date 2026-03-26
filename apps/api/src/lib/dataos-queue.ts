import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { DATAOS_LAKE_QUEUE_NAME, type DataOsLakeEventPayload } from '@patioer/dataos-client'

export interface DataOsQueueConfig {
  enabled: boolean
  redisUrl: string
}

export type EnqueueLakeEvent = ((payload: DataOsLakeEventPayload) => Promise<void>) & {
  close: () => Promise<void>
}

/**
 * Factory: creates the enqueue function with injected config (Harness pattern).
 * No module-level env reads — configuration flows from the composition root.
 */
export function createLakeQueueEnqueuer(config: DataOsQueueConfig): EnqueueLakeEvent {
  if (!config.enabled) {
    const noop: EnqueueLakeEvent = Object.assign(
      async (_payload: DataOsLakeEventPayload): Promise<void> => {},
      { close: async () => {} },
    )
    return noop
  }
  let queue: Queue<DataOsLakeEventPayload, void, string> | null = null
  let redis: Redis | null = null
  let initPromise: Promise<void> | null = null
  let closed = false

  const ensureQueue = async (): Promise<void> => {
    if (queue || closed) return
    if (initPromise) {
      await initPromise
      return
    }
    initPromise = (async () => {
      const nextRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: null })
      const nextQueue = new Queue<DataOsLakeEventPayload, void, string>(DATAOS_LAKE_QUEUE_NAME, {
        connection: nextRedis,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: false,
        },
      })
      redis = nextRedis
      queue = nextQueue
    })()
    try {
      await initPromise
    } finally {
      initPromise = null
    }
  }

  const enqueue = (async (payload: DataOsLakeEventPayload): Promise<void> => {
    if (closed) return
    await ensureQueue()
    if (!queue || closed) return
    try {
      await queue.add('lake', payload)
    } catch (err) {
      console.warn('[dataos-queue] enqueue failed', err)
    }
  }) as EnqueueLakeEvent

  enqueue.close = async () => {
    if (closed) return
    closed = true
    await initPromise?.catch(() => undefined)
    try {
      await queue?.close()
    } finally {
      queue = null
      if (redis) {
        await redis.quit().catch(() => undefined)
        redis = null
      }
    }
  }

  return enqueue
}

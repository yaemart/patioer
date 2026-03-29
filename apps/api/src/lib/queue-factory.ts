import {
  Queue,
  Worker,
  type ConnectionOptions,
  type JobsOptions,
  type WorkerOptions,
  type Job,
} from 'bullmq'
import { Redis } from 'ioredis'
import { getRedisClient } from './redis.js'

export type QueueName =
  | 'amazon-api-requests'
  | 'tiktok-api-requests'
  | 'shopee-api-requests'
  | 'walmart-api-requests'
  | 'webhook-processing'

const queueCache = new Map<QueueName, Queue>()
// Workers must use a dedicated Redis connection because BullMQ Workers use
// the BLPOP/XREAD blocking commands, which are incompatible with a shared
// connection used for non-blocking Queue operations.
const workerCache = new Map<QueueName, Worker>()

function newRedisConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  // maxRetriesPerRequest: null is required by BullMQ
  return new Redis(url, { maxRetriesPerRequest: null }) as unknown as ConnectionOptions
}

export function getQueue(name: QueueName): Queue {
  const cached = queueCache.get(name)
  if (cached) return cached
  // Queue's connection is re-used from the shared client; it only sends
  // non-blocking commands so sharing is safe here.
  const connection = getRedisClient() as unknown as ConnectionOptions
  const queue = new Queue(name, { connection })
  queueCache.set(name, queue)
  return queue
}

export async function enqueueJob<T = unknown>(
  queueName: QueueName,
  jobName: string,
  payload: T,
  opts?: JobsOptions,
): Promise<Job<T>> {
  const queue = getQueue(queueName)
  return queue.add(jobName, payload, opts)
}

export function createWorker<T = unknown>(
  queueName: QueueName,
  processor: (job: Job<T>) => Promise<unknown>,
  opts?: Omit<WorkerOptions, 'connection'>,
): Worker<T> {
  const existing = workerCache.get(queueName)
  if (existing) return existing as Worker<T>

  const connection = newRedisConnection()
  const worker = new Worker<T>(queueName, processor, {
    connection,
    ...opts,
  })
  workerCache.set(queueName, worker as Worker)
  return worker
}

export async function closeAllQueues(): Promise<void> {
  const queuesToClose = Array.from(queueCache.values())
  const workersToClose = Array.from(workerCache.values())
  queueCache.clear()
  workerCache.clear()

  // Use allSettled so one failing close does not prevent others from draining.
  const results = await Promise.allSettled([
    ...queuesToClose.map((q) => q.close()),
    ...workersToClose.map((w) => w.close()),
  ])

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('Error closing BullMQ resource:', result.reason)
    }
  }
}

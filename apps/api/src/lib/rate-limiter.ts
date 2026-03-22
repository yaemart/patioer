import type { JobsOptions } from 'bullmq'
import { enqueueJob, getQueue, type QueueName } from './queue-factory.js'

export interface PlatformRateLimit {
  maxPerSecond: number
  burst: number
}

export type PlatformId = 'shopify' | 'amazon' | 'tiktok' | 'shopee'

const PLATFORM_LIMITS: Record<PlatformId, PlatformRateLimit> = {
  shopify: { maxPerSecond: 2, burst: 2 },
  amazon: { maxPerSecond: 0.5, burst: 1 },
  tiktok: { maxPerSecond: 10, burst: 20 },
  shopee: { maxPerSecond: 10, burst: 20 },
}

const PLATFORM_QUEUES: Record<PlatformId, QueueName> = {
  shopify: 'webhook-processing',
  amazon: 'amazon-api-requests',
  tiktok: 'tiktok-api-requests',
  shopee: 'shopee-api-requests',
}

export function getPlatformRateLimit(platform: PlatformId): PlatformRateLimit {
  return PLATFORM_LIMITS[platform]
}

export function getPlatformQueueName(platform: PlatformId): QueueName {
  return PLATFORM_QUEUES[platform]
}

export async function enqueuePlatformRequest<T = unknown>(
  platform: PlatformId,
  jobName: string,
  payload: T,
  opts?: JobsOptions,
) {
  return enqueueJob(getPlatformQueueName(platform), jobName, payload, opts)
}

export function getAmazonRequestQueue() {
  return getQueue('amazon-api-requests')
}

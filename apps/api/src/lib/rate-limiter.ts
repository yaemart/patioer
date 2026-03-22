import type { JobsOptions } from 'bullmq'
import { enqueueJob, getQueue, type QueueName } from './queue-factory.js'
import type { SupportedPlatform } from './supported-platforms.js'

export interface PlatformRateLimit {
  maxPerSecond: number
  burst: number
}

const PLATFORM_LIMITS: Record<SupportedPlatform, PlatformRateLimit> = {
  shopify: { maxPerSecond: 2, burst: 2 },
  amazon: { maxPerSecond: 0.5, burst: 1 },
  tiktok: { maxPerSecond: 10, burst: 20 },
  shopee: { maxPerSecond: 10, burst: 20 },
}

const PLATFORM_QUEUES: Record<SupportedPlatform, QueueName> = {
  shopify: 'webhook-processing',
  amazon: 'amazon-api-requests',
  tiktok: 'tiktok-api-requests',
  shopee: 'shopee-api-requests',
}

export function getPlatformRateLimit(platform: SupportedPlatform): PlatformRateLimit {
  return PLATFORM_LIMITS[platform]
}

export function getPlatformQueueName(platform: SupportedPlatform): QueueName {
  return PLATFORM_QUEUES[platform]
}

export async function enqueuePlatformRequest<T = unknown>(
  platform: SupportedPlatform,
  jobName: string,
  payload: T,
  opts?: JobsOptions,
) {
  return enqueueJob(getPlatformQueueName(platform), jobName, payload, opts)
}

export function getAmazonRequestQueue() {
  return getQueue('amazon-api-requests')
}

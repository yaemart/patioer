import { describe, expect, it, vi } from 'vitest'

const { mockEnqueueJob, mockGetQueue } = vi.hoisted(() => ({
  mockEnqueueJob: vi.fn(async () => ({ id: 'job-1' })),
  mockGetQueue: vi.fn(() => ({ name: 'amazon-api-requests' })),
}))

vi.mock('./queue-factory.js', () => ({
  enqueueJob: mockEnqueueJob,
  getQueue: mockGetQueue,
}))

import {
  enqueuePlatformRequest,
  getAmazonRequestQueue,
  getPlatformQueueName,
  getPlatformRateLimit,
} from './rate-limiter.js'

describe('rate limiter', () => {
  it('getPlatformRateLimit returns configured value for amazon', () => {
    expect(getPlatformRateLimit('amazon')).toEqual({ maxPerSecond: 0.5, burst: 1 })
  })

  it('getPlatformRateLimit returns configured value for shopify', () => {
    expect(getPlatformRateLimit('shopify')).toEqual({ maxPerSecond: 2, burst: 2 })
  })

  it('getPlatformQueueName maps platform to expected queue', () => {
    expect(getPlatformQueueName('amazon')).toBe('amazon-api-requests')
    expect(getPlatformQueueName('tiktok')).toBe('tiktok-api-requests')
    expect(getPlatformQueueName('shopee')).toBe('shopee-api-requests')
    expect(getPlatformQueueName('shopify')).toBe('webhook-processing')
  })

  it('enqueuePlatformRequest pushes job into mapped queue', async () => {
    await enqueuePlatformRequest('amazon', 'fetch-orders', { tenantId: 't-1' })
    expect(mockEnqueueJob).toHaveBeenCalledWith(
      'amazon-api-requests',
      'fetch-orders',
      { tenantId: 't-1' },
      undefined,
    )
  })

  it('getAmazonRequestQueue returns amazon-api-requests queue', () => {
    const queue = getAmazonRequestQueue()
    expect(queue).toEqual({ name: 'amazon-api-requests' })
    expect(mockGetQueue).toHaveBeenCalledWith('amazon-api-requests')
  })
})

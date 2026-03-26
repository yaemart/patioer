import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAdd = vi.fn().mockResolvedValue({ id: 'job-123' })
const mockQueueClose = vi.fn().mockResolvedValue(undefined)
const mockRedisQuit = vi.fn().mockResolvedValue('OK')
const mockQueueCtor = vi.fn()
const mockRedisCtor = vi.fn()

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    constructor() {
      mockQueueCtor()
    }
    add = mockAdd
    close = mockQueueClose
  },
}))

vi.mock('ioredis', () => ({
  Redis: class MockRedis {
    constructor() {
      mockRedisCtor()
    }
    quit = mockRedisQuit
  },
}))

import { createLakeQueueEnqueuer } from './dataos-queue.js'

describe('createLakeQueueEnqueuer', () => {
  beforeEach(() => {
    mockAdd.mockClear()
    mockQueueClose.mockClear()
    mockRedisQuit.mockClear()
    mockQueueCtor.mockClear()
    mockRedisCtor.mockClear()
  })

  it('returns a no-op function when disabled', async () => {
    const enqueue = createLakeQueueEnqueuer({ enabled: false, redisUrl: 'redis://localhost:6379' })
    await enqueue({
      tenantId: '550e8400-e29b-41d4-a716-446655440001',
      agentId: 'price-sentinel',
      eventType: 'test',
      payload: {},
    })
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('enqueues with correct payload when enabled', async () => {
    const enqueue = createLakeQueueEnqueuer({ enabled: true, redisUrl: 'redis://localhost:6379' })
    const payload = {
      tenantId: '550e8400-e29b-41d4-a716-446655440001',
      platform: 'shopify',
      agentId: 'price-sentinel',
      eventType: 'price.updated',
      entityId: 'sku-1',
      payload: { before: 10, after: 12 },
    }
    await enqueue(payload)
    expect(mockAdd).toHaveBeenCalledTimes(1)
    const [jobName, jobData] = mockAdd.mock.calls[0] as [string, unknown]
    expect(jobName).toBe('lake')
    expect(jobData).toEqual(payload)
  })

  it('swallows errors without throwing (non-blocking)', async () => {
    mockAdd.mockRejectedValueOnce(new Error('Redis unavailable'))
    const enqueue = createLakeQueueEnqueuer({ enabled: true, redisUrl: 'redis://localhost:6379' })
    await expect(
      enqueue({
        tenantId: '550e8400-e29b-41d4-a716-446655440001',
        agentId: 'a',
        eventType: 'e',
        payload: {},
      }),
    ).resolves.toBeUndefined()
  })

  it('closes queue and redis connection on enqueuer.close()', async () => {
    const enqueue = createLakeQueueEnqueuer({ enabled: true, redisUrl: 'redis://localhost:6379' })
    await enqueue({
      tenantId: '550e8400-e29b-41d4-a716-446655440001',
      agentId: 'price-sentinel',
      eventType: 'test',
      payload: {},
    })
    await enqueue.close()
    expect(mockQueueClose).toHaveBeenCalledTimes(1)
    expect(mockRedisQuit).toHaveBeenCalledTimes(1)
  })

  it('initializes queue/redis only once under concurrent first enqueue calls', async () => {
    const enqueue = createLakeQueueEnqueuer({ enabled: true, redisUrl: 'redis://localhost:6379' })
    const payload = {
      tenantId: '550e8400-e29b-41d4-a716-446655440001',
      agentId: 'price-sentinel',
      eventType: 'test',
      payload: {},
    }
    await Promise.all([enqueue(payload), enqueue(payload)])
    expect(mockRedisCtor).toHaveBeenCalledTimes(1)
    expect(mockQueueCtor).toHaveBeenCalledTimes(1)
    expect(mockAdd).toHaveBeenCalledTimes(2)
  })
})

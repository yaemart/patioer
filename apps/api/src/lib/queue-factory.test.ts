import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockQueueCtor,
  mockWorkerCtor,
  mockQueueAdd,
  mockQueueClose,
  mockWorkerClose,
  mockGetRedisClient,
  mockRedisCtor,
} = vi.hoisted(() => ({
  mockQueueCtor: vi.fn(),
  mockWorkerCtor: vi.fn(),
  mockQueueAdd: vi.fn(async () => ({ id: 'job-1' })),
  mockQueueClose: vi.fn(async () => undefined),
  mockWorkerClose: vi.fn(async () => undefined),
  mockGetRedisClient: vi.fn(() => ({ client: 'redis' })),
  mockRedisCtor: vi.fn(() => ({ client: 'worker-redis' })),
}))

vi.mock('./redis.js', () => ({
  getRedisClient: mockGetRedisClient,
}))

vi.mock('ioredis', () => ({
  Redis: function MockRedis(this: unknown) {
    mockRedisCtor()
    return { client: 'worker-redis' }
  },
}))

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    name: string
    add = mockQueueAdd
    close = mockQueueClose
    constructor(name: string, opts: unknown) {
      this.name = name
      mockQueueCtor(name, opts)
    }
  },
  Worker: class MockWorker {
    close = mockWorkerClose
    constructor(name: string, processor: unknown, opts: unknown) {
      mockWorkerCtor(name, processor, opts)
    }
  },
}))

import {
  closeAllQueues,
  createWorker,
  enqueueJob,
  getQueue,
} from './queue-factory.js'

describe('queue factory', () => {
  beforeEach(async () => {
    await closeAllQueues()
    mockQueueCtor.mockClear()
    mockWorkerCtor.mockClear()
    mockQueueAdd.mockClear()
    mockQueueClose.mockClear()
    mockWorkerClose.mockClear()
    mockGetRedisClient.mockClear()
    mockRedisCtor.mockClear()
  })

  it('getQueue returns same queue instance for same name', () => {
    const a = getQueue('amazon-api-requests')
    const b = getQueue('amazon-api-requests')
    expect(a).toBe(b)
    expect(mockQueueCtor).toHaveBeenCalledTimes(1)
  })

  it('getQueue returns different queue instances for different names', () => {
    const a = getQueue('amazon-api-requests')
    const b = getQueue('tiktok-api-requests')
    expect(a).not.toBe(b)
    expect(mockQueueCtor).toHaveBeenCalledTimes(2)
  })

  it('enqueueJob adds job into target queue', async () => {
    await enqueueJob('amazon-api-requests', 'sync-orders', { tenantId: 't-1' })
    expect(mockQueueAdd).toHaveBeenCalledWith('sync-orders', { tenantId: 't-1' }, undefined)
  })

  it('createWorker uses a dedicated (non-shared) Redis connection', () => {
    const processor = vi.fn(async () => undefined)
    createWorker('webhook-processing', processor, { concurrency: 2 })
    // Worker must NOT reuse the shared getRedisClient() connection.
    expect(mockGetRedisClient).not.toHaveBeenCalled()
    // Instead it creates a fresh Redis instance via ioredis.
    expect(mockRedisCtor).toHaveBeenCalledTimes(1)
    expect(mockWorkerCtor).toHaveBeenCalledWith(
      'webhook-processing',
      processor,
      expect.objectContaining({
        connection: { client: 'worker-redis' },
        concurrency: 2,
      }),
    )
  })

  it('createWorker returns cached instance on second call', () => {
    const processor = vi.fn(async () => undefined)
    const w1 = createWorker('webhook-processing', processor)
    const w2 = createWorker('webhook-processing', processor)
    expect(w1).toBe(w2)
    expect(mockWorkerCtor).toHaveBeenCalledTimes(1)
  })

  it('closeAllQueues closes queues and workers then clears caches', async () => {
    getQueue('amazon-api-requests')
    getQueue('tiktok-api-requests')
    createWorker('webhook-processing', vi.fn(async () => undefined))
    await closeAllQueues()
    expect(mockQueueClose).toHaveBeenCalledTimes(2)
    expect(mockWorkerClose).toHaveBeenCalledTimes(1)
    // After clear, new queue must be re-created
    getQueue('amazon-api-requests')
    expect(mockQueueCtor).toHaveBeenCalledTimes(3)
  })
})

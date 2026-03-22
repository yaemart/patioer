import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCtor, mockQuit, mockPing } = vi.hoisted(() => ({
  mockCtor: vi.fn(),
  mockQuit: vi.fn(async () => 'OK'),
  mockPing: vi.fn(async () => 'PONG'),
}))

vi.mock('ioredis', () => ({
  Redis: class MockRedis {
    constructor(url: string, opts: unknown) {
      mockCtor(url, opts)
    }
    quit = mockQuit
    ping = mockPing
  },
}))

import { assertRedisConnection, closeRedisClient, getRedisClient } from './redis.js'

describe('redis lib', () => {
  beforeEach(async () => {
    delete process.env.REDIS_URL
    await closeRedisClient()
    mockCtor.mockClear()
    mockQuit.mockClear()
    mockPing.mockClear()
    mockPing.mockResolvedValue('PONG')
  })

  it('getRedisClient returns singleton instance', () => {
    const a = getRedisClient()
    const b = getRedisClient()
    expect(a).toBe(b)
    expect(mockCtor).toHaveBeenCalledTimes(1)
  })

  it('getRedisClient uses REDIS_URL from env', async () => {
    await closeRedisClient()
    process.env.REDIS_URL = 'redis://redis-from-env:6379'
    getRedisClient()
    expect(mockCtor).toHaveBeenCalledWith(
      'redis://redis-from-env:6379',
      expect.objectContaining({ maxRetriesPerRequest: null }),
    )
  })

  it('assertRedisConnection returns true when ping is PONG', async () => {
    const ok = await assertRedisConnection()
    expect(ok).toBe(true)
    expect(mockPing).toHaveBeenCalledTimes(1)
  })

  it('closeRedisClient can be called multiple times safely', async () => {
    getRedisClient()
    await closeRedisClient()
    await closeRedisClient()
    expect(mockQuit).toHaveBeenCalledTimes(1)
  })
})

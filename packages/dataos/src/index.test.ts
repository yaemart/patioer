import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createDataOsServices } from './index.js'
import { DecisionMemoryService } from './decision-memory.js'

const { mockPool, mockRedis, mockEventLake, mockFeatureStore, mockDecisionMemory } = vi.hoisted(() => ({
  mockPool: { end: vi.fn().mockResolvedValue(undefined) },
  mockRedis: { quit: vi.fn().mockResolvedValue(undefined) },
  mockEventLake: { close: vi.fn().mockResolvedValue(undefined) },
  mockFeatureStore: {},
  mockDecisionMemory: {},
}))

vi.mock('pg', () => ({ Pool: vi.fn().mockImplementation(function () { return mockPool }) }))
vi.mock('ioredis', () => ({ Redis: vi.fn().mockImplementation(function () { return mockRedis }) }))
vi.mock('./event-lake.js', () => ({ EventLakeService: vi.fn().mockImplementation(function () { return mockEventLake }) }))
vi.mock('./feature-store.js', () => ({ FeatureStoreService: vi.fn().mockImplementation(function () { return mockFeatureStore }) }))
vi.mock('./decision-memory.js', () => ({ DecisionMemoryService: vi.fn().mockImplementation(function () { return mockDecisionMemory }) }))

const cfg = {
  databaseUrl: 'postgres://dataos:dataos@localhost:5434/dataos',
  redisUrl: 'redis://localhost:6380',
  clickhouse: { url: 'http://localhost:8123' },
}

describe('createDataOsServices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEventLake.close = vi.fn().mockResolvedValue(undefined)
    mockRedis.quit = vi.fn().mockResolvedValue(undefined)
    mockPool.end = vi.fn().mockResolvedValue(undefined)
  })

  it('returns all service instances', () => {
    const svc = createDataOsServices(cfg)
    expect(svc.pool).toBe(mockPool)
    expect(svc.redis).toBe(mockRedis)
    expect(svc.eventLake).toBe(mockEventLake)
    expect(svc.featureStore).toBe(mockFeatureStore)
    expect(svc.decisionMemory).toBe(mockDecisionMemory)
  })

  it('shutdown calls eventLake.close, redis.quit, pool.end in order', async () => {
    const order: string[] = []
    mockEventLake.close = vi.fn(async () => { order.push('eventLake.close') })
    mockRedis.quit = vi.fn(async () => { order.push('redis.quit') })
    mockPool.end = vi.fn(async () => { order.push('pool.end') })

    const svc = createDataOsServices(cfg)
    await svc.shutdown()

    expect(order).toEqual(['eventLake.close', 'redis.quit', 'pool.end'])
  })

  it('passes EmbeddingPort to DecisionMemoryService', () => {
    const port = { embed: vi.fn() }
    createDataOsServices({ ...cfg, embedding: port })
    expect(vi.mocked(DecisionMemoryService)).toHaveBeenCalledWith(mockPool, port)
  })

  it('omits embedding when not provided', () => {
    createDataOsServices(cfg)
    expect(vi.mocked(DecisionMemoryService)).toHaveBeenCalledWith(mockPool, undefined)
  })
})

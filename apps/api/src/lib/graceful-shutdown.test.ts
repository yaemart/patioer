import { describe, expect, it, vi } from 'vitest'
import { gracefulShutdown } from './graceful-shutdown.js'

describe('gracefulShutdown', () => {
  it('gracefulShutdown closes fastify app and redis client', async () => {
    const closeApp = vi.fn(async () => undefined)
    const closeRedis = vi.fn(async () => undefined)

    const code = await gracefulShutdown(closeApp, closeRedis)

    expect(code).toBe(0)
    expect(closeApp).toHaveBeenCalledTimes(1)
    expect(closeRedis).toHaveBeenCalledTimes(1)
  })

  it('gracefulShutdown still closes redis when closeApp throws', async () => {
    const closeApp = vi.fn(async () => {
      throw new Error('boom')
    })
    const closeRedis = vi.fn(async () => undefined)

    const code = await gracefulShutdown(closeApp, closeRedis)

    expect(code).toBe(1)
    expect(closeApp).toHaveBeenCalledTimes(1)
    expect(closeRedis).toHaveBeenCalledTimes(1)
  })

  it('gracefulShutdown still closes redis when closeQueues throws', async () => {
    const closeApp = vi.fn(async () => undefined)
    const closeQueues = vi.fn(async () => {
      throw new Error('queue error')
    })
    const closeRedis = vi.fn(async () => undefined)

    const code = await gracefulShutdown(closeApp, closeRedis, closeQueues)

    expect(code).toBe(1)
    expect(closeApp).toHaveBeenCalledTimes(1)
    expect(closeQueues).toHaveBeenCalledTimes(1)
    expect(closeRedis).toHaveBeenCalledTimes(1)
  })

  it('gracefulShutdown returns 1 when all steps fail', async () => {
    const closeApp = vi.fn(async () => { throw new Error('app') })
    const closeQueues = vi.fn(async () => { throw new Error('queues') })
    const closeRedis = vi.fn(async () => { throw new Error('redis') })

    const code = await gracefulShutdown(closeApp, closeRedis, closeQueues)

    expect(code).toBe(1)
    expect(closeApp).toHaveBeenCalledTimes(1)
    expect(closeQueues).toHaveBeenCalledTimes(1)
    expect(closeRedis).toHaveBeenCalledTimes(1)
  })
})

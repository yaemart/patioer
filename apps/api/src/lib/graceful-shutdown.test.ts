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

  it('gracefulShutdown exits with failure when close throws', async () => {
    const closeApp = vi.fn(async () => {
      throw new Error('boom')
    })
    const closeRedis = vi.fn(async () => undefined)

    const code = await gracefulShutdown(closeApp, closeRedis)

    expect(code).toBe(1)
    expect(closeApp).toHaveBeenCalledTimes(1)
    expect(closeRedis).not.toHaveBeenCalled()
  })
})

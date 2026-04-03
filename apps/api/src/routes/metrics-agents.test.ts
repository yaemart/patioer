import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import metricsAgentsRoute from './metrics-agents.js'

function createApp(
  dbResults: unknown[],
  options?: { withTenant?: boolean },
) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    if (options?.withTenant === false) {
      request.withDb = null
      request.tenantId = undefined
      return
    }

    request.tenantId = '123e4567-e89b-12d3-a456-426614174000'
    const queue = [...dbResults]
    request.withDb = (async <T>(callback: (db: never) => Promise<T>) => {
      return await callback({
        select: () => ({
          from: () => ({
            where: () => queue.shift() ?? [{ cnt: 0 }],
          }),
        }),
      } as never)
    }) as never
  })
  app.register(metricsAgentsRoute)
  return app
}

describe('metrics-agents route', () => {
  it('returns 401 without tenant', async () => {
    const app = createApp([], { withTenant: false })
    const res = await app.inject({ method: 'GET', url: '/api/v1/metrics/agents' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns metrics shape with tenant', async () => {
    const app = createApp([])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/metrics/agents',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveProperty('decisions')
    expect(body).toHaveProperty('harnessApiErrorRate')
    expect(body).toHaveProperty('pendingApprovals')
    expect(body).toHaveProperty('sop')
    expect(body).toHaveProperty('checkedAt')
    await app.close()
  })
})

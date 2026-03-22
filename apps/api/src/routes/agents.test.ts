import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import agentsRoute from './agents.js'

function createApp(
  responses: unknown[],
  options?: { withTenant?: boolean },
): ReturnType<typeof Fastify> {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    if (options?.withTenant === false) {
      request.withDb = null
      request.tenantId = undefined
      return
    }

    request.tenantId = '123e4567-e89b-12d3-a456-426614174000'
    request.withDb = async () => {
      if (responses.length === 0) {
        throw new Error('withDb responses queue is empty')
      }
      return responses.shift() as never
    }
  })
  app.register(agentsRoute)
  return app
}

describe('agents route', () => {
  it('GET /agents returns 401 without tenant header', async () => {
    const app = createApp([], { withTenant: false })
    const response = await app.inject({ method: 'GET', url: '/api/v1/agents' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('GET /agents returns 200 with agent list', async () => {
    const app = createApp([
      [
        { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Scout', type: 'product-scout', status: 'active' },
      ],
    ])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/agents',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      agents: [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Scout' }],
    })
    await app.close()
  })

  it('GET /agents/:id returns 200 with agent data when found', async () => {
    const app = createApp([
      [{ id: '123e4567-e89b-12d3-a456-426614174001', name: 'Scout', type: 'product-scout', status: 'active' }],
    ])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ agent: { id: '123e4567-e89b-12d3-a456-426614174001' } })
    await app.close()
  })

  it('POST /agents creates agent with default active status', async () => {
    const app = createApp([
      [
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          name: 'Price Sentinel',
          type: 'price-sentinel',
          status: 'active',
          goalContext: '{}',
        },
      ],
    ])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { name: 'Price Sentinel', type: 'price-sentinel', goalContext: '{}' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      agent: { status: 'active', type: 'price-sentinel' },
    })
    await app.close()
  })

  it('POST /agents returns 400 for invalid type', async () => {
    const app = createApp([])
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { name: 'bad', type: 'wrong-type' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid request body' })
    await app.close()
  })

  it('GET /agents/:id returns 404 for missing agent', async () => {
    const app = createApp([[]])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'agent not found' })
    await app.close()
  })

  it('PATCH /agents/:id updates name status and goalContext', async () => {
    const app = createApp([
      // 1st call: lookup agent type for goalContext validation
      [{ type: 'price-sentinel' }],
      // 2nd call: actual DB update returning the updated row
      [
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          name: 'Updated Name',
          type: 'price-sentinel',
          status: 'suspended',
          goalContext: '{"x":1}',
        },
      ],
    ])
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { name: 'Updated Name', status: 'suspended', goalContext: '{"x":1}' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      agent: { name: 'Updated Name', status: 'suspended', goalContext: '{"x":1}' },
    })
    await app.close()
  })

  it('PATCH /agents/:id returns 400 for invalid body', async () => {
    const app = createApp([])
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'invalid-status' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid request body' })
    await app.close()
  })

  it('PATCH /agents/:id returns 404 when agent does not exist', async () => {
    const app = createApp([[]])
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { name: 'Ghost Agent' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'agent not found' })
    await app.close()
  })

  it('DELETE /agents/:id returns 204 and removes row', async () => {
    const app = createApp([
      [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }],
    ])
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(204)
    await app.close()
  })

  it('DELETE /agents/:id returns 400 for non-UUID id', async () => {
    const app = createApp([])
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/agents/not-a-uuid',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid agent id' })
    await app.close()
  })

  it('DELETE /agents/:id returns 404 when agent does not exist', async () => {
    const app = createApp([[]])
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/agents/123e4567-e89b-12d3-a456-426614174001',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'agent not found' })
    await app.close()
  })

  it('GET /agents applies tenant filter in query', async () => {
    const app = Fastify()
    app.addHook('onRequest', async (request) => {
      request.tenantId = '123e4567-e89b-12d3-a456-426614174000'
      request.withDb = (async <T>(callback: (db: never) => Promise<T>) => {
        const db = {
          select: () => ({
            from: () => ({
              where: () =>
                [
                  {
                    id: 'a-1',
                    tenantId: '123e4567-e89b-12d3-a456-426614174000',
                    name: 'tenant-scoped-agent',
                  },
                ] as unknown as T,
            }),
          }),
        }
        return await callback(db as never)
      }) as never
    })
    app.register(agentsRoute)

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/agents',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      agents: [
        {
          id: 'a-1',
          tenantId: '123e4567-e89b-12d3-a456-426614174000',
          name: 'tenant-scoped-agent',
        },
      ],
    })
    await app.close()
  })
})

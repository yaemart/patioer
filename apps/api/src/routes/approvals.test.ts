import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import approvalsRoute from './approvals.js'

function createApp(
  responses: unknown[],
  options?: { withTenant?: boolean },
): { app: ReturnType<typeof Fastify>; calls: { count: number } } {
  const app = Fastify()
  const calls = { count: 0 }
  app.addHook('onRequest', async (request) => {
    if (options?.withTenant === false) {
      request.withDb = null
      request.tenantId = undefined
      return
    }

    request.tenantId = '123e4567-e89b-12d3-a456-426614174000'
    request.withDb = async () => {
      calls.count += 1
      if (responses.length === 0) {
        throw new Error('withDb responses queue is empty')
      }
      return responses.shift() as never
    }
  })
  app.register(approvalsRoute)
  return { app, calls }
}

describe('approvals route', () => {
  it('GET /approvals returns only tenant rows', async () => {
    const { app } = createApp([
      [
        { id: 'a1', tenantId: '123e4567-e89b-12d3-a456-426614174000', status: 'pending' },
      ],
    ])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      approvals: [{ id: 'a1', tenantId: '123e4567-e89b-12d3-a456-426614174000', status: 'pending' }],
    })
    await app.close()
  })

  it('GET /approvals supports status filter', async () => {
    const { app } = createApp([
      [{ id: 'a1', status: 'approved' }],
    ])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals?status=approved',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ approvals: [{ id: 'a1', status: 'approved' }] })
    await app.close()
  })

  it('allows pending to approved transition', async () => {
    const { app } = createApp([
      [{ id: 'a1', status: 'pending', agentId: '123e4567-e89b-12d3-a456-426614174001' }],
      { id: 'a1', status: 'approved', resolvedBy: 'ops' },
    ])
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/approvals/123e4567-e89b-12d3-a456-426614174001/resolve',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'approved', resolvedBy: 'ops' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      approval: { id: 'a1', status: 'approved', resolvedBy: 'ops' },
    })
    await app.close()
  })

  it('allows pending to rejected transition', async () => {
    const { app } = createApp([
      [{ id: 'a1', status: 'pending', agentId: '123e4567-e89b-12d3-a456-426614174001' }],
      { id: 'a1', status: 'rejected', resolvedBy: 'ops' },
    ])
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/approvals/123e4567-e89b-12d3-a456-426614174001/resolve',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'rejected', resolvedBy: 'ops' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      approval: { id: 'a1', status: 'rejected', resolvedBy: 'ops' },
    })
    await app.close()
  })

  it('is idempotent when resolving already approved approval to approved', async () => {
    const { app } = createApp([
      [{ id: 'a1', status: 'approved', agentId: '123e4567-e89b-12d3-a456-426614174001' }],
    ])
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/approvals/123e4567-e89b-12d3-a456-426614174001/resolve',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'approved', resolvedBy: 'ops' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      approval: { id: 'a1', status: 'approved', agentId: '123e4567-e89b-12d3-a456-426614174001' },
    })
    await app.close()
  })

  it('returns conflict when resolving already resolved approval with different status', async () => {
    const { app } = createApp([
      [{ id: 'a1', status: 'approved', agentId: '123e4567-e89b-12d3-a456-426614174001' }],
    ])
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/approvals/123e4567-e89b-12d3-a456-426614174001/resolve',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'rejected', resolvedBy: 'ops' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'approval already resolved' })
    await app.close()
  })

  it('returns 404 when approval does not exist', async () => {
    const { app } = createApp([[]])
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/approvals/123e4567-e89b-12d3-a456-426614174001/resolve',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'approved', resolvedBy: 'ops' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'approval not found' })
    await app.close()
  })

  it('writes audit event atomically with approval update', async () => {
    const { app, calls } = createApp([
      [{ id: 'a1', status: 'pending', agentId: '123e4567-e89b-12d3-a456-426614174001' }],
      { id: 'a1', status: 'approved', resolvedBy: 'ops' },
    ])
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/approvals/123e4567-e89b-12d3-a456-426614174001/resolve',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'approved', resolvedBy: 'ops' },
    })
    expect(response.statusCode).toBe(200)
    expect(calls.count).toBe(2)
    await app.close()
  })

  it('returns 409 when concurrent resolve wins the race', async () => {
    const { app } = createApp([
      [{ id: 'a1', status: 'pending', agentId: '123e4567-e89b-12d3-a456-426614174001' }],
      null,
    ])
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/approvals/123e4567-e89b-12d3-a456-426614174001/resolve',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'approved', resolvedBy: 'ops' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'approval already resolved' })
    await app.close()
  })
})

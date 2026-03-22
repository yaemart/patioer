import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import approvalsRoute from './approvals.js'

/** RFC-compliant UUIDs — `:id` uses `z.string().uuid()`. */
const APPROVAL_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const OTHER_APPROVAL_ID = '7ba7b810-9dad-11d1-80b4-00c04fd430c8'

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
  it('GET /approvals returns 401 without x-tenant-id', async () => {
    const { app } = createApp([], { withTenant: false })
    const response = await app.inject({ method: 'GET', url: '/api/v1/approvals' })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'x-tenant-id required' })
    await app.close()
  })

  it('GET /approvals returns 400 for invalid status query parameter', async () => {
    const { app } = createApp([])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals?status=invalid',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid query' })
    await app.close()
  })

  it('GET /approvals/:id returns 401 without x-tenant-id', async () => {
    const { app } = createApp([], { withTenant: false })
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/approvals/${APPROVAL_ID}`,
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'x-tenant-id required' })
    await app.close()
  })

  it('GET /approvals/:id returns 400 for non-UUID id', async () => {
    const { app } = createApp([])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals/not-a-uuid',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid approval id' })
    await app.close()
  })

  it('GET /approvals/:id returns 404 when approval does not exist', async () => {
    const { app } = createApp([[]])
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/approvals/${APPROVAL_ID}`,
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'approval not found' })
    await app.close()
  })

  it('GET /approvals/:id returns 200 with approval data', async () => {
    const { app } = createApp([
      [{ id: APPROVAL_ID, tenantId: '123e4567-e89b-12d3-a456-426614174000', status: 'pending', action: 'price.update' }],
    ])
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/approvals/${APPROVAL_ID}`,
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      approval: { id: APPROVAL_ID, tenantId: '123e4567-e89b-12d3-a456-426614174000', status: 'pending', action: 'price.update' },
    })
    await app.close()
  })

  it('PATCH /approvals/:id/resolve returns 400 for invalid body', async () => {
    const { app } = createApp([])
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/approvals/${APPROVAL_ID}/resolve`,
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'invalid-status', resolvedBy: 'ops' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid request body' })
    await app.close()
  })

  it('GET /approvals returns only tenant rows', async () => {
    const { app } = createApp([
      [
        {
          id: APPROVAL_ID,
          tenantId: '123e4567-e89b-12d3-a456-426614174000',
          status: 'pending',
        },
      ],
    ])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      approvals: [
        {
          id: APPROVAL_ID,
          tenantId: '123e4567-e89b-12d3-a456-426614174000',
          status: 'pending',
        },
      ],
    })
    await app.close()
  })

  it('GET /approvals supports status filter', async () => {
    const { app } = createApp([[{ id: APPROVAL_ID, status: 'approved' }]])
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/approvals?status=approved',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ approvals: [{ id: APPROVAL_ID, status: 'approved' }] })
    await app.close()
  })

  it('allows pending to approved transition', async () => {
    const { app } = createApp([
      [{ id: APPROVAL_ID, status: 'pending', agentId: '123e4567-e89b-12d3-a456-426614174001' }],
      { id: APPROVAL_ID, status: 'approved', resolvedBy: 'ops' },
    ])
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/approvals/${APPROVAL_ID}/resolve`,
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'approved', resolvedBy: 'ops' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      approval: { id: APPROVAL_ID, status: 'approved', resolvedBy: 'ops' },
    })
    await app.close()
  })

  it('allows pending to rejected transition', async () => {
    const { app } = createApp([
      [{ id: APPROVAL_ID, status: 'pending', agentId: '123e4567-e89b-12d3-a456-426614174001' }],
      { id: APPROVAL_ID, status: 'rejected', resolvedBy: 'ops' },
    ])
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/approvals/${APPROVAL_ID}/resolve`,
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'rejected', resolvedBy: 'ops' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      approval: { id: APPROVAL_ID, status: 'rejected', resolvedBy: 'ops' },
    })
    await app.close()
  })

  it('is idempotent when resolving already approved approval to approved', async () => {
    const { app } = createApp([
      [{ id: APPROVAL_ID, status: 'approved', agentId: '123e4567-e89b-12d3-a456-426614174001' }],
    ])
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/approvals/${APPROVAL_ID}/resolve`,
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'approved', resolvedBy: 'ops' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      approval: {
        id: APPROVAL_ID,
        status: 'approved',
        agentId: '123e4567-e89b-12d3-a456-426614174001',
      },
    })
    await app.close()
  })

  it('returns conflict when resolving already resolved approval with different status', async () => {
    const { app } = createApp([
      [{ id: APPROVAL_ID, status: 'approved', agentId: '123e4567-e89b-12d3-a456-426614174001' }],
    ])
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/approvals/${APPROVAL_ID}/resolve`,
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
      url: `/api/v1/approvals/${OTHER_APPROVAL_ID}/resolve`,
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'approved', resolvedBy: 'ops' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'approval not found' })
    await app.close()
  })

  it('writes audit event atomically with approval update', async () => {
    const { app, calls } = createApp([
      [{ id: APPROVAL_ID, status: 'pending', agentId: '123e4567-e89b-12d3-a456-426614174001' }],
      { id: APPROVAL_ID, status: 'approved', resolvedBy: 'ops' },
    ])
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/approvals/${APPROVAL_ID}/resolve`,
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'approved', resolvedBy: 'ops' },
    })
    expect(response.statusCode).toBe(200)
    expect(calls.count).toBe(2)
    await app.close()
  })

  it('returns 409 when concurrent resolve wins the race', async () => {
    const { app } = createApp([
      [{ id: APPROVAL_ID, status: 'pending', agentId: '123e4567-e89b-12d3-a456-426614174001' }],
      [],
    ])
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/approvals/${APPROVAL_ID}/resolve`,
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'approved', resolvedBy: 'ops' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: 'approval already resolved' })
    await app.close()
  })

  it('PATCH /approvals/:id/resolve returns 400 for non-UUID id', async () => {
    const { app } = createApp([])
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/approvals/not-a-uuid/resolve',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'approved', resolvedBy: 'ops' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid approval id' })
    await app.close()
  })

  it('PATCH /approvals/:id/resolve executes db.update and db.insert atomically via callback', async () => {
    const updatedRow = { id: APPROVAL_ID, status: 'approved', resolvedBy: 'admin', agentId: '123e4567-e89b-12d3-a456-426614174001' }
    const insertedAuditEvents: unknown[] = []

    const selectLimit = vi.fn().mockResolvedValue([{ id: APPROVAL_ID, status: 'pending', agentId: '123e4567-e89b-12d3-a456-426614174001' }])
    const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit })
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere })
    const selectChain = vi.fn().mockReturnValue({ from: selectFrom })

    const updateReturning = vi.fn().mockResolvedValue([updatedRow])
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning })
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere })
    const updateChain = vi.fn().mockReturnValue({ set: updateSet })

    const insertValues = vi.fn().mockImplementation((v: unknown) => {
      insertedAuditEvents.push(v)
      return Promise.resolve(undefined)
    })
    const insertChain = vi.fn().mockReturnValue({ values: insertValues })

    const callbackDb = {
      select: selectChain,
      update: updateChain,
      insert: insertChain,
    }

    let callCount = 0
    const app = Fastify()
    app.addHook('onRequest', async (request) => {
      request.tenantId = '123e4567-e89b-12d3-a456-426614174000'
      request.withDb = (async <T>(callback: (db: never) => Promise<T>) => {
        callCount += 1
        return await callback(callbackDb as never)
      }) as never
    })
    app.register(approvalsRoute)

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/approvals/${APPROVAL_ID}/resolve`,
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
      payload: { status: 'approved', resolvedBy: 'admin' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ approval: updatedRow })
    expect(callCount).toBe(2)
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', resolvedBy: 'admin' }),
    )
    expect(insertedAuditEvents).toHaveLength(1)
    expect(insertedAuditEvents[0]).toMatchObject({
      action: 'approval.resolved.approved',
    })
    await app.close()
  })
})

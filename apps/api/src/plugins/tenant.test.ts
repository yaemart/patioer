import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

const { mockWithTenantDb } = vi.hoisted(() => ({
  mockWithTenantDb: vi.fn(),
}))

vi.mock('@patioer/db', () => ({
  withTenantDb: mockWithTenantDb,
}))

import tenantPlugin from './tenant.js'

function createApp() {
  const app = Fastify({ logger: false })
  app.register(tenantPlugin)
  app.get('/echo', async (request) => ({
    tenantId: request.tenantId ?? null,
    role: request.auth?.role ?? null,
    hasWithDb: typeof request.withDb === 'function',
  }))
  return app
}

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000'
const ANOTHER_UUID = '7ba7b810-9dad-11d1-80b4-00c04fd430c8'

function makeAuthHeaders(tenantId = VALID_UUID, role = 'owner') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({
    userId: 'user-test',
    tenantId,
    email: 'test@example.com',
    role,
    plan: 'starter',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url')
  const signature = createHmac('sha256', 'dev-only-secret-not-for-production')
    .update(`${header}.${body}`)
    .digest('base64url')
  return {
    authorization: `Bearer ${header}.${body}.${signature}`,
    'x-tenant-id': tenantId,
  }
}

function makeMachineAuthHeaders(tenantId = VALID_UUID) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({
    tenantId,
    role: 'service',
    plan: 'starter',
    subjectType: 'machine',
    serviceAccountId: 'svc-test-1',
    serviceAccountName: 'ops-bot',
    scopes: ['clipmart:write'],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url')
  const signature = createHmac('sha256', 'dev-only-secret-not-for-production')
    .update(`${header}.${body}`)
    .digest('base64url')
  return {
    authorization: `Bearer ${header}.${body}.${signature}`,
    'x-tenant-id': tenantId,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWithTenantDb.mockResolvedValue(undefined)
})

describe('tenant plugin', () => {
  it('sets tenantId, auth, and withDb when valid JWT is present', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/echo',
      headers: makeAuthHeaders(),
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ tenantId: VALID_UUID, role: 'owner', hasWithDb: true })
    await app.close()
  })

  it('accepts machine JWTs and exposes service role', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/echo',
      headers: makeMachineAuthHeaders(),
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ tenantId: VALID_UUID, role: 'service', hasWithDb: true })
    await app.close()
  })

  it('returns 401 for protected routes without JWT', async () => {
    const app = createApp()
    const response = await app.inject({ method: 'GET', url: '/echo' })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'JWT authentication required' })
    await app.close()
  })

  it('returns 400 when x-tenant-id is not a valid UUID', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/echo',
        headers: { authorization: makeAuthHeaders().authorization, 'x-tenant-id': 'not-a-uuid' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'x-tenant-id must be a valid UUID' })
    await app.close()
  })

  it('returns 400 when x-tenant-id contains only digits (not UUID format)', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/echo',
        headers: { authorization: makeAuthHeaders().authorization, 'x-tenant-id': '12345' },
    })
    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('returns 401 when JWT tenant does not match x-tenant-id', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/echo',
      headers: {
        authorization: makeAuthHeaders().authorization,
        'x-tenant-id': ANOTHER_UUID,
      },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'JWT tenant does not match x-tenant-id' })
    await app.close()
  })

  it('withDb delegates to withTenantDb with correct tenantId', async () => {
    const app = Fastify({ logger: false })
    app.register(tenantPlugin)
    app.get('/call-db', async (request) => {
      if (request.withDb) await request.withDb(async () => 'ok')
      return { called: true }
    })
    await app.inject({
      method: 'GET',
      url: '/call-db',
      headers: makeAuthHeaders(),
    })
    expect(mockWithTenantDb).toHaveBeenCalledOnce()
    expect(mockWithTenantDb).toHaveBeenCalledWith(VALID_UUID, expect.any(Function))
    await app.close()
  })

  it('two concurrent requests use separate tenant contexts', async () => {
    const app = createApp()
    const [r1, r2] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/echo',
        headers: makeAuthHeaders(VALID_UUID),
      }),
      app.inject({
        method: 'GET',
        url: '/echo',
        headers: makeAuthHeaders(ANOTHER_UUID),
      }),
    ])
    expect(r1.json().tenantId).toBe(VALID_UUID)
    expect(r2.json().tenantId).toBe(ANOTHER_UUID)
    await app.close()
  })

  it('accepts UUID with uppercase hex letters', async () => {
    const uppercaseUuid = VALID_UUID.toUpperCase()
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/echo',
        headers: makeAuthHeaders(uppercaseUuid),
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().tenantId).toBe(uppercaseUuid)
    await app.close()
  })
})

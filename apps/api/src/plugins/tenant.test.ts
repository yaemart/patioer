import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    hasWithDb: typeof request.withDb === 'function',
  }))
  return app
}

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000'
const ANOTHER_UUID = '7ba7b810-9dad-11d1-80b4-00c04fd430c8'

beforeEach(() => {
  vi.clearAllMocks()
  mockWithTenantDb.mockResolvedValue(undefined)
})

describe('tenant plugin', () => {
  it('sets tenantId and withDb when valid UUID header is present', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/echo',
      headers: { 'x-tenant-id': VALID_UUID },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ tenantId: VALID_UUID, hasWithDb: true })
    await app.close()
  })

  it('does not set tenantId when x-tenant-id header is absent', async () => {
    const app = createApp()
    const response = await app.inject({ method: 'GET', url: '/echo' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ tenantId: null, hasWithDb: false })
    await app.close()
  })

  it('returns 400 when x-tenant-id is not a valid UUID', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/echo',
      headers: { 'x-tenant-id': 'not-a-uuid' },
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
      headers: { 'x-tenant-id': '12345' },
    })
    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('does not block request when x-tenant-id is absent (route handles 401)', async () => {
    const app = createApp()
    const response = await app.inject({ method: 'GET', url: '/echo' })
    // Plugin itself doesn't reject — route is responsible for the 401
    expect(response.statusCode).toBe(200)
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
      headers: { 'x-tenant-id': VALID_UUID },
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
        headers: { 'x-tenant-id': VALID_UUID },
      }),
      app.inject({
        method: 'GET',
        url: '/echo',
        headers: { 'x-tenant-id': ANOTHER_UUID },
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
      headers: { 'x-tenant-id': uppercaseUuid },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().tenantId).toBe(uppercaseUuid)
    await app.close()
  })
})

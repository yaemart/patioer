import Fastify from 'fastify'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockInvalidate } = vi.hoisted(() => ({
  mockInvalidate: vi.fn(),
}))

vi.mock('../lib/harness-registry.js', () => ({
  registry: { invalidate: mockInvalidate },
}))

import platformCredentialsRoute from './platform-credentials.js'

const TENANT_ID = '00000000-0000-4000-8000-000000000001'
const CRED_ID = '00000000-0000-4000-8000-000000000002'

const credRow = {
  id: CRED_ID,
  platform: 'shopify',
  credentialType: 'oauth',
  shopDomain: 'demo.myshopify.com',
  region: 'global',
  scopes: 'read_products',
  metadata: null,
  expiresAt: null,
  createdAt: new Date().toISOString(),
}

function createApp(
  responses: unknown[],
  options?: { withTenant?: boolean },
) {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    if (options?.withTenant === false) {
      request.withDb = null
      request.tenantId = undefined
      return
    }
    request.tenantId = TENANT_ID
    request.withDb = async () => {
      if (responses.length === 0) throw new Error('empty responses queue')
      return responses.shift() as never
    }
  })
  app.register(platformCredentialsRoute)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/platform-credentials', () => {
  it('returns 401 without tenant', async () => {
    const app = createApp([], { withTenant: false })
    const res = await app.inject({ method: 'GET', url: '/api/v1/platform-credentials' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'x-tenant-id required' })
    await app.close()
  })

  it('returns credentials list', async () => {
    const app = createApp([[credRow]])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/platform-credentials',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { credentials: typeof credRow[] }
    expect(body.credentials).toHaveLength(1)
    expect(body.credentials[0]!.platform).toBe('shopify')
    await app.close()
  })

  it('returns empty list when no credentials', async () => {
    const app = createApp([[]])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/platform-credentials',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { credentials: unknown[] }).credentials).toEqual([])
    await app.close()
  })
})

describe('GET /api/v1/platform-credentials/:id', () => {
  it('returns 400 with invalid UUID', async () => {
    const app = createApp([])
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/platform-credentials/not-a-uuid',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'invalid credential id' })
    await app.close()
  })

  it('returns 404 when credential not found', async () => {
    const app = createApp([[]])
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/platform-credentials/${CRED_ID}`,
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'credential not found' })
    await app.close()
  })

  it('returns credential by ID', async () => {
    const app = createApp([[credRow]])
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/platform-credentials/${CRED_ID}`,
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { credential: typeof credRow }).credential.id).toBe(CRED_ID)
    await app.close()
  })

  it('returns 401 without tenant', async () => {
    const app = createApp([], { withTenant: false })
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/platform-credentials/${CRED_ID}`,
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})

describe('DELETE /api/v1/platform-credentials/:id', () => {
  it('returns 401 without tenant', async () => {
    const app = createApp([], { withTenant: false })
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/platform-credentials/${CRED_ID}`,
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns 400 with invalid UUID', async () => {
    const app = createApp([])
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/platform-credentials/not-a-uuid',
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('returns 404 when credential not found', async () => {
    const app = createApp([[]])
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/platform-credentials/${CRED_ID}`,
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'credential not found' })
    await app.close()
  })

  it('deletes credential and invalidates harness cache', async () => {
    const app = createApp([[{ ...credRow, platform: 'shopify' }]])
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/platform-credentials/${CRED_ID}`,
      headers: { 'x-tenant-id': TENANT_ID },
    })
    expect(res.statusCode).toBe(204)
    expect(mockInvalidate).toHaveBeenCalledWith(`${TENANT_ID}:shopify`)
    await app.close()
  })
})

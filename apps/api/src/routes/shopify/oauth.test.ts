import { createHmac } from 'node:crypto'
import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWithTenantDb, mockEncryptToken } = vi.hoisted(() => ({
  mockWithTenantDb: vi.fn(),
  mockEncryptToken: vi.fn(),
}))

vi.mock('@patioer/db', () => ({
  withTenantDb: mockWithTenantDb,
  schema: {
    platformCredentials: {
      tenantId: 'tenantId',
      platform: 'platform',
      shopDomain: 'shopDomain',
    },
  },
}))

vi.mock('../../lib/crypto.js', () => ({
  encryptToken: mockEncryptToken,
}))

import shopifyOauthRoute from './oauth.js'

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const APP_BASE_URL = 'https://app.example.com'
const ENCRYPTION_KEY = '0'.repeat(64)

function buildValidCallbackHmac(
  params: Record<string, string>,
  secret: string,
): string {
  const { hmac: _ignored, ...rest } = params
  const message = Object.entries(rest)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return createHmac('sha256', secret).update(message).digest('hex')
}

function signStateForTest(tenantId: string, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ tenantId, nonce: 'testnonce', iat: Date.now() }),
  ).toString('base64url')
  const hmac = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${hmac}`
}

function createApp(): ReturnType<typeof Fastify> {
  const app = Fastify({ logger: false })
  app.decorateRequest('tenantId', undefined)
  app.decorateRequest('withDb', null)
  app.addHook('onRequest', async (request) => {
    const tid = request.headers['x-tenant-id']
    if (typeof tid === 'string') request.tenantId = tid
  })
  app.register(shopifyOauthRoute)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SHOPIFY_CLIENT_ID = CLIENT_ID
  process.env.SHOPIFY_CLIENT_SECRET = CLIENT_SECRET
  process.env.APP_BASE_URL = APP_BASE_URL
  process.env.SHOPIFY_ENCRYPTION_KEY = ENCRYPTION_KEY
  mockEncryptToken.mockReturnValue('encrypted-token')
  mockWithTenantDb.mockImplementation(async (_tid: string, cb: (db: unknown) => Promise<unknown>) => {
    const db = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }
    return await cb(db)
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/shopify/auth
// ---------------------------------------------------------------------------

describe('GET /api/v1/shopify/auth', () => {
  it('returns 503 when SHOPIFY_CLIENT_ID is not configured', async () => {
    delete process.env.SHOPIFY_CLIENT_ID
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/shopify/auth?shop=demo.myshopify.com',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(503)
    await app.close()
  })

  it('returns 401 when x-tenant-id header is missing', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/shopify/auth?shop=demo.myshopify.com',
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'x-tenant-id required' })
    await app.close()
  })

  it('returns 400 when shop query param is missing', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/shopify/auth',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid shop domain' })
    await app.close()
  })

  it('returns 400 when shop domain format is invalid', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/shopify/auth?shop=not-a-shopify-domain.com',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid shop domain' })
    await app.close()
  })

  it('returns 302 redirect to Shopify OAuth consent URL', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/shopify/auth?shop=demo.myshopify.com',
      headers: { 'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(response.statusCode).toBe(302)
    const location = response.headers.location as string
    expect(location).toContain('demo.myshopify.com/admin/oauth/authorize')
    expect(location).toContain(`client_id=${CLIENT_ID}`)
    expect(location).toContain(`redirect_uri=${encodeURIComponent(`${APP_BASE_URL}/api/v1/shopify/callback`)}`)
    await app.close()
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/shopify/callback
// ---------------------------------------------------------------------------

describe('GET /api/v1/shopify/callback', () => {
  it('returns 503 when SHOPIFY_CLIENT_SECRET is not configured', async () => {
    delete process.env.SHOPIFY_CLIENT_SECRET
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/shopify/callback?state=x&shop=demo.myshopify.com&code=auth_code&hmac=abc',
    })
    expect(response.statusCode).toBe(503)
    await app.close()
  })

  it('returns 401 when HMAC verification fails', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/shopify/callback?state=x&shop=demo.myshopify.com&code=auth_code&hmac=invalid',
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'invalid HMAC' })
    await app.close()
  })

  it('returns 400 when state is missing or invalid', async () => {
    const app = createApp()
    const params = { shop: 'demo.myshopify.com', code: 'auth_code', state: '' }
    const hmac = buildValidCallbackHmac(params, CLIENT_SECRET)
    const qs = new URLSearchParams({ ...params, hmac }).toString()
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/shopify/callback?${qs}`,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid state' })
    await app.close()
  })

  it('returns 400 when OAuth state is expired', async () => {
    const app = createApp()
    const oldPayload = Buffer.from(
      JSON.stringify({ tenantId: 'tid', nonce: 'n', iat: Date.now() - 15 * 60 * 1000 }),
    ).toString('base64url')
    const oldHmac = createHmac('sha256', CLIENT_SECRET).update(oldPayload).digest('hex')
    const expiredState = `${oldPayload}.${oldHmac}`
    const params = { shop: 'demo.myshopify.com', code: 'auth_code', state: expiredState }
    const hmac = buildValidCallbackHmac(params, CLIENT_SECRET)
    const qs = new URLSearchParams({ ...params, hmac }).toString()
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/shopify/callback?${qs}`,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'OAuth state expired' })
    await app.close()
  })

  it('returns 400 when authorization code is missing', async () => {
    const app = createApp()
    const state = signStateForTest('123e4567-e89b-12d3-a456-426614174000', CLIENT_SECRET)
    const params = { shop: 'demo.myshopify.com', code: '', state }
    const hmac = buildValidCallbackHmac(params, CLIENT_SECRET)
    const qs = new URLSearchParams({ ...params, hmac }).toString()
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/shopify/callback?${qs}`,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'missing authorization code' })
    await app.close()
  })

  it('returns 502 when Shopify token exchange fails', async () => {
    const app = createApp()
    const state = signStateForTest('123e4567-e89b-12d3-a456-426614174000', CLIENT_SECRET)
    const params = { shop: 'demo.myshopify.com', code: 'auth_code', state }
    const hmac = buildValidCallbackHmac(params, CLIENT_SECRET)
    const qs = new URLSearchParams({ ...params, hmac }).toString()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: vi.fn() }))
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/shopify/callback?${qs}`,
    })
    expect(response.statusCode).toBe(502)
    vi.unstubAllGlobals()
    await app.close()
  })

  it('persists encrypted credentials and returns 200 on success', async () => {
    const app = createApp()
    const state = signStateForTest('123e4567-e89b-12d3-a456-426614174000', CLIENT_SECRET)
    const params = { shop: 'demo.myshopify.com', code: 'auth_code', state }
    const hmac = buildValidCallbackHmac(params, CLIENT_SECRET)
    const qs = new URLSearchParams({ ...params, hmac }).toString()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ access_token: 'raw-token', scope: 'read_products' }),
    }))
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/shopify/callback?${qs}`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(mockEncryptToken).toHaveBeenCalledWith('raw-token', ENCRYPTION_KEY)
    expect(mockWithTenantDb).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
    await app.close()
  })
})

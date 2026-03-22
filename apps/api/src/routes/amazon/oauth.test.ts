import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import amazonOAuthRoute from './oauth.js'

// --- Mocks ---
vi.mock('@patioer/db', () => ({
  withTenantDb: vi.fn(),
  schema: {
    platformCredentials: {
      tenantId: 'tenantId',
      platform: 'platform',
      region: 'region',
    },
  },
}))
vi.mock('../../lib/crypto.js', () => ({
  encryptToken: vi.fn((_token: string, _key: string) => 'encrypted-refresh-token'),
}))
vi.mock('../../lib/harness-registry.js', () => ({
  registry: { invalidate: vi.fn() },
}))

const { withTenantDb } = await import('@patioer/db')
const { encryptToken } = await import('../../lib/crypto.js')
const { registry } = await import('../../lib/harness-registry.js')

const ENV = {
  AMAZON_CLIENT_ID: 'client-id',
  AMAZON_CLIENT_SECRET: 'client-secret',
  APP_BASE_URL: 'https://example.com',
  CRED_ENCRYPTION_KEY: '0'.repeat(64),
}

function buildApp() {
  const app = Fastify()
  app.register(amazonOAuthRoute)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(process.env, ENV)
  vi.mocked(global.fetch).mockReset?.()
})

describe('GET /api/v1/amazon/auth', () => {
  it('returns 503 when AMAZON_CLIENT_ID is missing', async () => {
    delete process.env.AMAZON_CLIENT_ID
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/amazon/auth?tenantId=t1&sellerId=s1&marketplaceId=ATVPDKIKX0DER' })
    expect(res.statusCode).toBe(503)
  })

  it('returns 400 when tenantId is missing', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/amazon/auth?sellerId=s1&marketplaceId=ATVPDKIKX0DER' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when sellerId is missing', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/amazon/auth?tenantId=t1&marketplaceId=ATVPDKIKX0DER' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when marketplaceId is missing', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/amazon/auth?tenantId=t1&sellerId=s1' })
    expect(res.statusCode).toBe(400)
  })

  it('redirects to Amazon LWA consent URL with correct params', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/amazon/auth?tenantId=t1&sellerId=s1&marketplaceId=ATVPDKIKX0DER&region=na' })
    expect(res.statusCode).toBe(302)
    const location = res.headers['location'] as string
    expect(location).toContain('sellercentral.amazon.com')
    expect(location).toContain('application_id=client-id')
    expect(location).toContain('state=')
  })
})

describe('GET /api/v1/amazon/auth/callback', () => {
  it('returns 503 when env is not configured', async () => {
    delete process.env.AMAZON_CLIENT_SECRET
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/amazon/auth/callback?state=bad&code=c' })
    expect(res.statusCode).toBe(503)
  })

  it('returns 400 when state is invalid', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/amazon/auth/callback?state=invalid&code=authcode' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('invalid state')
  })

  it('returns 400 when code is missing', async () => {
    // First get a valid state by calling /auth
    const app = buildApp()
    const authRes = await app.inject({ method: 'GET', url: '/api/v1/amazon/auth?tenantId=t1&sellerId=s1&marketplaceId=ATVPDKIKX0DER' })
    const location = authRes.headers['location'] as string
    const state = new URL(location).searchParams.get('state')!

    const res = await app.inject({ method: 'GET', url: `/api/v1/amazon/auth/callback?state=${encodeURIComponent(state)}` })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('missing authorization code')
  })

  it('returns 502 when LWA token exchange fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 } as Response)
    const app = buildApp()
    const authRes = await app.inject({ method: 'GET', url: '/api/v1/amazon/auth?tenantId=t1&sellerId=s1&marketplaceId=ATVPDKIKX0DER' })
    const location = authRes.headers['location'] as string
    const state = new URL(location).searchParams.get('state')!

    const res = await app.inject({ method: 'GET', url: `/api/v1/amazon/auth/callback?state=${encodeURIComponent(state)}&code=authcode` })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toBe('failed to exchange Amazon OAuth token')
  })

  it('returns 502 when LWA network request throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    const app = buildApp()
    const authRes = await app.inject({ method: 'GET', url: '/api/v1/amazon/auth?tenantId=t1&sellerId=s1&marketplaceId=ATVPDKIKX0DER' })
    const location = authRes.headers['location'] as string
    const state = new URL(location).searchParams.get('state')!

    const res = await app.inject({ method: 'GET', url: `/api/v1/amazon/auth/callback?state=${encodeURIComponent(state)}&code=authcode` })
    expect(res.statusCode).toBe(502)
  })

  it('persists encrypted credentials and returns ok:true on success', async () => {
    const fakeToken = {
      access_token: 'Atza|access',
      refresh_token: 'Atzr|refresh',
      token_type: 'bearer',
      expires_in: 3600,
    }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeToken,
    } as Response)
    vi.mocked(withTenantDb).mockImplementation(async (_tenantId, fn) => {
      await fn({ insert: () => ({ values: () => ({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }) }) } as never)
    })

    const app = buildApp()
    const authRes = await app.inject({ method: 'GET', url: '/api/v1/amazon/auth?tenantId=t1&sellerId=s1&marketplaceId=ATVPDKIKX0DER' })
    const location = authRes.headers['location'] as string
    const state = new URL(location).searchParams.get('state')!

    const res = await app.inject({ method: 'GET', url: `/api/v1/amazon/auth/callback?state=${encodeURIComponent(state)}&code=authcode` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(encryptToken).toHaveBeenCalledWith('Atzr|refresh', ENV.CRED_ENCRYPTION_KEY)
    expect(registry.invalidate).toHaveBeenCalledWith('t1:amazon')
  })

  it('returns 500 when db insert fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'Atza|access',
        refresh_token: 'Atzr|refresh',
        token_type: 'bearer',
        expires_in: 3600,
      }),
    } as Response)
    vi.mocked(withTenantDb).mockRejectedValue(new Error('db error'))

    const app = buildApp()
    const authRes = await app.inject({ method: 'GET', url: '/api/v1/amazon/auth?tenantId=t1&sellerId=s1&marketplaceId=ATVPDKIKX0DER' })
    const location = authRes.headers['location'] as string
    const state = new URL(location).searchParams.get('state')!

    const res = await app.inject({ method: 'GET', url: `/api/v1/amazon/auth/callback?state=${encodeURIComponent(state)}&code=authcode` })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toBe('failed to save credentials')
  })
})

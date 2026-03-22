import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import shopeeOAuthRoute, { buildShopeeAuthSign } from './oauth.js'

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
  encryptToken: vi.fn((_t: string, _k: string) => 'encrypted-token'),
}))
vi.mock('../../lib/harness-registry.js', () => ({
  registry: { invalidate: vi.fn() },
}))

const { withTenantDb } = await import('@patioer/db')
const { encryptToken } = await import('../../lib/crypto.js')
const { registry } = await import('../../lib/harness-registry.js')

const ENV = {
  SHOPEE_PARTNER_ID: '100001',
  SHOPEE_PARTNER_KEY: 'test-partner-key',
  APP_BASE_URL: 'https://app.example.com',
  CRED_ENCRYPTION_KEY: '0'.repeat(64),
}

function buildApp() {
  const app = Fastify({ logger: false })
  app.register(shopeeOAuthRoute, { prefix: '/api/v1/shopee' })
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(process.env, ENV)
  global.fetch = vi.fn() as typeof fetch
})

describe('buildShopeeAuthSign', () => {
  it('matches HMAC-SHA256(partnerId + path + timestamp)', () => {
    const sign = buildShopeeAuthSign('secret', 1, '/api/v2/shop/auth_partner', 1700000000)
    expect(sign).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('GET /api/v1/shopee/auth', () => {
  it('GET /auth returns 400 when tenantId is missing', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/shopee/auth?market=SG' })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ error: string }>().error).toContain('tenantId')
  })

  it('GET /auth returns 400 when market is missing', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/shopee/auth?tenantId=t1' })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ error: string }>().error).toContain('market')
  })

  it('GET /auth redirects to Shopee auth URL with signed params', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/shopee/auth?tenantId=t1&market=SG',
    })
    expect(res.statusCode).toBe(302)
    const loc = res.headers.location as string
    expect(loc).toContain('auth_partner')
    expect(loc).toContain('partner_id=100001')
    expect(loc).toContain('sign=')
    expect(loc).toContain('state=')
    expect(loc).toContain('redirect=')
  })

  it('returns 503 when Shopee OAuth env is incomplete', async () => {
    delete process.env.SHOPEE_PARTNER_ID
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/shopee/auth?tenantId=t1&market=SG',
    })
    expect(res.statusCode).toBe(503)
  })
})

describe('GET /api/v1/shopee/auth/callback', () => {
  it('GET /auth/callback returns 400 when required params missing', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/shopee/auth/callback' })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ error: string }>().error).toContain('code')
  })

  it('GET /auth/callback returns 400 when state is invalid', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/shopee/auth/callback?code=c1&shop_id=1&state=not-valid-base64!!!',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ error: string }>().error).toContain('invalid state')
  })

  it('GET /auth/callback returns 502 when token exchange fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'bad' }),
    }) as unknown as typeof fetch

    const state = Buffer.from(JSON.stringify({ tenantId: 't1', market: 'SG' })).toString('base64url')
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/shopee/auth/callback?code=auth-code&shop_id=999&state=${encodeURIComponent(state)}`,
    })
    expect(res.statusCode).toBe(502)
    expect(res.json<{ error: string }>().error).toContain('token exchange')
  })

  it('GET /auth/callback persists encrypted token with region=market', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'at-xyz' }),
    }) as unknown as typeof fetch

    vi.mocked(withTenantDb).mockImplementationOnce(async (_tid, fn) => {
      await fn({
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: vi.fn().mockResolvedValueOnce(undefined),
          }),
        }),
      } as never)
    })

    const state = Buffer.from(JSON.stringify({ tenantId: 'tenant-uuid', market: 'MY' })).toString(
      'base64url',
    )
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/shopee/auth/callback?code=ok-code&shop_id=12345&state=${encodeURIComponent(state)}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, shopId: '12345', market: 'MY' })
    expect(encryptToken).toHaveBeenCalledWith('at-xyz', ENV.CRED_ENCRYPTION_KEY)
    expect(registry.invalidate).toHaveBeenCalledWith('tenant-uuid:shopee')
  })
})

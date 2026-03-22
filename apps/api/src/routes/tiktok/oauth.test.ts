import { createHmac } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import tikTokOAuthRoute from './oauth.js'

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
  encryptToken: vi.fn((_token: string, _key: string) => 'encrypted-access-token'),
}))
vi.mock('../../lib/harness-registry.js', () => ({
  registry: { invalidate: vi.fn() },
}))

const { withTenantDb } = await import('@patioer/db')
const { encryptToken } = await import('../../lib/crypto.js')
const { registry } = await import('../../lib/harness-registry.js')

const APP_SECRET = 'test-app-secret-value'
const STATE_SECRET = 'state-signing-secret'
const APP_BASE_URL = 'https://app.example.com'
const ENC_KEY = '0'.repeat(64)
const APP_KEY = 'test-app-key'
const TENANT_ID = 'tenant-abc'

const ENV = {
  TIKTOK_APP_SECRET: APP_SECRET,
  TIKTOK_STATE_SECRET: STATE_SECRET,
  APP_BASE_URL,
  CRED_ENCRYPTION_KEY: ENC_KEY,
}

function buildApp() {
  const app = Fastify({ logger: false })
  app.register(tikTokOAuthRoute)
  return app
}

/** Builds a valid HMAC-signed state matching the production signTikTokState logic. */
function buildValidState(
  payload: { tenantId: string; appKey: string; shopId?: string },
  secret: string,
): string {
  const full = { ...payload, nonce: 'testnonce', iat: Date.now() }
  const encoded = Buffer.from(JSON.stringify(full)).toString('base64url')
  const hmac = createHmac('sha256', secret).update(encoded).digest('hex')
  return `${encoded}.${hmac}`
}

/** A minimal successful TikTok token API response envelope. */
function tikTokTokenOk(accessToken = 'at-123') {
  return {
    code: 0,
    message: 'success',
    data: {
      access_token: accessToken,
      refresh_token: 'rt-xyz',
      open_id: 'open-1',
      seller_name: 'Test Seller',
      seller_base_region: 'US',
      expire_in: 86400,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(process.env, ENV)
})

// ── GET /api/v1/tiktok/auth ───────────────────────────────────────────────────

describe('GET /api/v1/tiktok/auth', () => {
  it('returns 503 when TIKTOK_APP_SECRET is missing', async () => {
    delete process.env.TIKTOK_APP_SECRET
    delete process.env.TIKTOK_STATE_SECRET
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tiktok/auth?tenantId=${TENANT_ID}&appKey=${APP_KEY}`,
    })
    expect(res.statusCode).toBe(503)
  })

  it('returns 400 when tenantId is missing', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: `/api/v1/tiktok/auth?appKey=${APP_KEY}` })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ error: string }>().error).toContain('tenantId')
  })

  it('returns 400 when appKey is missing', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: `/api/v1/tiktok/auth?tenantId=${TENANT_ID}` })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ error: string }>().error).toContain('appKey')
  })

  it('redirects to TikTok authorization URL with app_key and state', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tiktok/auth?tenantId=${TENANT_ID}&appKey=${APP_KEY}`,
    })
    expect(res.statusCode).toBe(302)
    const location = res.headers['location'] as string
    expect(location).toContain('auth.tiktok-shops.com')
    expect(location).toContain(`app_key=${APP_KEY}`)
    expect(location).toContain('state=')
    expect(location).toContain('redirect_uri=')
  })
})

// ── GET /api/v1/tiktok/auth/callback ─────────────────────────────────────────

describe('GET /api/v1/tiktok/auth/callback', () => {
  it('returns 503 when TIKTOK_APP_SECRET is missing', async () => {
    delete process.env.TIKTOK_APP_SECRET
    delete process.env.TIKTOK_STATE_SECRET
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/tiktok/auth/callback' })
    expect(res.statusCode).toBe(503)
  })

  it('returns 400 when state is invalid', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tiktok/auth/callback?code=auth-code&state=notvalidbase64!!!',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ error: string }>().error).toContain('invalid state')
  })

  it('returns 400 when code is missing', async () => {
    const state = buildValidState({ tenantId: TENANT_ID, appKey: APP_KEY }, STATE_SECRET)
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tiktok/auth/callback?state=${encodeURIComponent(state)}`,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ error: string }>().error).toContain('authorization code')
  })

  it('returns 502 when token fetch throws network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))

    const state = buildValidState({ tenantId: TENANT_ID, appKey: APP_KEY }, STATE_SECRET)
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tiktok/auth/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    })
    expect(res.statusCode).toBe(502)
  })

  it('returns 502 when token endpoint returns non-OK HTTP status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 400, message: 'bad_request' }),
    } as Response)

    const state = buildValidState({ tenantId: TENANT_ID, appKey: APP_KEY }, STATE_SECRET)
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tiktok/auth/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    })
    expect(res.statusCode).toBe(502)
  })

  it('returns 502 when TikTok API code is non-zero', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 40001, message: 'invalid auth_code' }),
    } as Response)

    const state = buildValidState({ tenantId: TENANT_ID, appKey: APP_KEY }, STATE_SECRET)
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tiktok/auth/callback?code=bad-code&state=${encodeURIComponent(state)}`,
    })
    expect(res.statusCode).toBe(502)
  })

  it('persists encrypted access_token and returns { ok: true }', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => tikTokTokenOk('access-tok-777'),
    } as Response)

    vi.mocked(withTenantDb).mockImplementationOnce(async (_tid, fn) => {
      await fn({
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: vi.fn().mockResolvedValueOnce(undefined),
          }),
        }),
      } as never)
    })

    const state = buildValidState({ tenantId: TENANT_ID, appKey: APP_KEY }, STATE_SECRET)
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tiktok/auth/callback?code=valid-code&state=${encodeURIComponent(state)}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(encryptToken).toHaveBeenCalledWith('access-tok-777', ENC_KEY)
    expect(registry.invalidate).toHaveBeenCalledWith(`${TENANT_ID}:tiktok`)
  })

  it('returns 500 when DB insert throws', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => tikTokTokenOk(),
    } as Response)
    vi.mocked(withTenantDb).mockRejectedValueOnce(new Error('db failure'))

    const state = buildValidState({ tenantId: TENANT_ID, appKey: APP_KEY }, STATE_SECRET)
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tiktok/auth/callback?code=valid-code&state=${encodeURIComponent(state)}`,
    })

    expect(res.statusCode).toBe(500)
  })
})

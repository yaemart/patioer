import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import walmartOAuthRoute from './oauth.js'
import { signOAuthState } from '../../lib/oauth-state.js'

const { mockPersistOAuthCredential } = vi.hoisted(() => ({
  mockPersistOAuthCredential: vi.fn(async () => {}),
}))

vi.mock('../../lib/oauth-credential-store.js', () => ({
  persistOAuthCredential: mockPersistOAuthCredential,
}))

function buildApp() {
  const app = Fastify({ logger: false })
  app.decorateRequest('tenantId', '')
  app.addHook('preHandler', async (request) => {
    const tenantHeader = request.headers['x-test-tenant-id']
    if (typeof tenantHeader === 'string') {
      ;(request as unknown as Record<string, unknown>).tenantId = tenantHeader
    }
  })
  app.register(walmartOAuthRoute)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRED_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.WALMART_STATE_SECRET = 'walmart-state-secret'
  process.env.APP_BASE_URL = 'https://app.example.com'
})

describe('POST /api/v1/walmart/credentials', () => {
  it('persists credentials for the authenticated tenant', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/walmart/credentials',
      headers: {
        'content-type': 'application/json',
        'x-test-tenant-id': '11111111-1111-1111-1111-111111111111',
      },
      payload: {
        clientId: 'wm-client',
        clientSecret: 'wm-secret',
        region: 'us',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockPersistOAuthCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '11111111-1111-1111-1111-111111111111',
        platform: 'walmart',
      }),
    )
    await app.close()
  })

  it('rejects body tenantId that does not match the JWT tenant', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/walmart/credentials',
      headers: {
        'content-type': 'application/json',
        'x-test-tenant-id': '11111111-1111-1111-1111-111111111111',
      },
      payload: {
        tenantId: '22222222-2222-2222-2222-222222222222',
        clientId: 'wm-client',
        clientSecret: 'wm-secret',
      },
    })

    expect(res.statusCode).toBe(401)
    expect(mockPersistOAuthCredential).not.toHaveBeenCalled()
    await app.close()
  })
})

describe('GET /api/v1/walmart/auth', () => {
  it('rejects query tenantId that does not match the JWT tenant', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/walmart/auth?tenantId=22222222-2222-2222-2222-222222222222',
      headers: {
        'x-test-tenant-id': '11111111-1111-1111-1111-111111111111',
      },
    })

    expect(res.statusCode).toBe(401)
    await app.close()
  })
})

describe('GET /api/v1/walmart/auth/callback', () => {
  it('confirms state for the authenticated tenant without accepting secrets via query', async () => {
    const app = buildApp()
    const state = signOAuthState(
      { tenantId: '11111111-1111-1111-1111-111111111111', region: 'us' },
      process.env.WALMART_STATE_SECRET!,
    )

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/walmart/auth/callback?state=${encodeURIComponent(state)}`,
      headers: {
        'x-test-tenant-id': '11111111-1111-1111-1111-111111111111',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      ok: true,
      tenantId: '11111111-1111-1111-1111-111111111111',
      nextStep: 'submit_credentials_via_post',
    })
    expect(mockPersistOAuthCredential).not.toHaveBeenCalled()
    await app.close()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import b2bWayfairRoute from './b2b-wayfair.js'

const { mockPersistOAuthCredential } = vi.hoisted(() => ({
  mockPersistOAuthCredential: vi.fn(async () => {}),
}))

vi.mock('../lib/oauth-credential-store.js', () => ({
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
  app.register(b2bWayfairRoute)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRED_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
})

describe('POST /api/v1/b2b/wayfair/credentials', () => {
  it('persists credentials for the authenticated tenant', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/b2b/wayfair/credentials',
      headers: {
        'content-type': 'application/json',
        'x-test-tenant-id': '11111111-1111-1111-1111-111111111111',
      },
      payload: {
        apiKey: 'wf-key',
        supplierId: 'supplier-1',
        apiBaseUrl: 'https://api.wayfair.test',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockPersistOAuthCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '11111111-1111-1111-1111-111111111111',
        platform: 'b2b',
        credentialType: 'wayfair_b2b',
      }),
    )
    await app.close()
  })

  it('rejects body tenantId that does not match the JWT tenant', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/b2b/wayfair/credentials',
      headers: {
        'content-type': 'application/json',
        'x-test-tenant-id': '11111111-1111-1111-1111-111111111111',
      },
      payload: {
        tenantId: '22222222-2222-2222-2222-222222222222',
        apiKey: 'wf-key',
        supplierId: 'supplier-1',
        apiBaseUrl: 'https://api.wayfair.test',
      },
    })

    expect(res.statusCode).toBe(401)
    expect(mockPersistOAuthCredential).not.toHaveBeenCalled()
    await app.close()
  })
})

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../app.js'
import { getTenantPublicBySlug } from '@patioer/db'

vi.mock('@patioer/db', async () => {
  const actual = await vi.importActual<typeof import('@patioer/db')>('@patioer/db')
  return {
    ...actual,
    getTenantPublicBySlug: vi.fn(),
  }
})

const app = buildServer()
const mockedGetTenantPublicBySlug = vi.mocked(getTenantPublicBySlug)
const originalDiscoveryApiKey = process.env.TENANT_DISCOVERY_API_KEY
const originalRateLimitMax = process.env.TENANT_DISCOVERY_RATE_LIMIT_MAX
const originalRateLimitWindow = process.env.TENANT_DISCOVERY_RATE_LIMIT_WINDOW_MS

beforeEach(() => {
  process.env.TENANT_DISCOVERY_API_KEY = 'test-discovery-key-default'
  process.env.TENANT_DISCOVERY_RATE_LIMIT_MAX = '100'
  process.env.TENANT_DISCOVERY_RATE_LIMIT_WINDOW_MS = '60000'
  mockedGetTenantPublicBySlug.mockReset()
})

afterEach(() => {
  process.env.TENANT_DISCOVERY_API_KEY = originalDiscoveryApiKey
  process.env.TENANT_DISCOVERY_RATE_LIMIT_MAX = originalRateLimitMax
  process.env.TENANT_DISCOVERY_RATE_LIMIT_WINDOW_MS = originalRateLimitWindow
})

afterAll(async () => {
  await app.close()
})

describe('tenant discovery route', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/resolve?slug=tenant-a',
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'unauthorized' })
  })

  it('returns only minimum tenant fields on success', async () => {
    process.env.TENANT_DISCOVERY_API_KEY = 'test-discovery-key-success'
    mockedGetTenantPublicBySlug.mockResolvedValue({ id: 'tenant-id-1', slug: 'tenant-a' })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/resolve?slug=tenant-a',
      headers: {
        'x-discovery-key': 'test-discovery-key-success',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      tenant: { id: 'tenant-id-1', slug: 'tenant-a' },
    })
  })

  it('returns generic not found for unknown tenants (anti-enumeration)', async () => {
    process.env.TENANT_DISCOVERY_API_KEY = 'test-discovery-key-not-found'
    mockedGetTenantPublicBySlug.mockResolvedValue(null)

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/resolve?slug=tenant-missing',
      headers: {
        'x-discovery-key': 'test-discovery-key-not-found',
      },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'resource not found' })
  })

  it('rate-limits repeated discovery attempts', async () => {
    process.env.TENANT_DISCOVERY_API_KEY = 'test-discovery-key-rate-limit'
    process.env.TENANT_DISCOVERY_RATE_LIMIT_MAX = '2'
    mockedGetTenantPublicBySlug.mockResolvedValue({ id: 'tenant-id-1', slug: 'tenant-a' })

    const req = () =>
      app.inject({
        method: 'GET',
        url: '/api/v1/tenants/resolve?slug=tenant-a',
        headers: {
          'x-discovery-key': 'test-discovery-key-rate-limit',
          'x-forwarded-for': '192.0.2.10',
        },
      })

    const first = await req()
    const second = await req()
    const third = await req()

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(third.statusCode).toBe(429)
    expect(third.json()).toEqual({ error: 'rate limit exceeded' })
  })
})

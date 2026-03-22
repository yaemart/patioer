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
  it('returns 503 when TENANT_DISCOVERY_API_KEY is not configured', async () => {
    delete process.env.TENANT_DISCOVERY_API_KEY
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/resolve?slug=tenant-a',
      headers: { 'x-discovery-key': 'any-key' },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'tenant discovery is disabled' })
  })

  it('returns 400 when slug contains invalid characters', async () => {
    process.env.TENANT_DISCOVERY_API_KEY = 'test-discovery-key-400'
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/resolve?slug=UPPER_CASE',
      headers: { 'x-discovery-key': 'test-discovery-key-400' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid slug' })
  })

  it('returns 400 when slug query parameter is missing', async () => {
    process.env.TENANT_DISCOVERY_API_KEY = 'test-discovery-key-no-slug'
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants/resolve',
      headers: { 'x-discovery-key': 'test-discovery-key-no-slug' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid slug' })
  })

  it('includes retry-after header when rate limit is exceeded', async () => {
    process.env.TENANT_DISCOVERY_API_KEY = 'test-discovery-key-retry'
    process.env.TENANT_DISCOVERY_RATE_LIMIT_MAX = '1'
    process.env.TENANT_DISCOVERY_RATE_LIMIT_WINDOW_MS = '60000'
    mockedGetTenantPublicBySlug.mockResolvedValue({ id: 'tid', slug: 'slug-a' })

    const req = () =>
      app.inject({
        method: 'GET',
        url: '/api/v1/tenants/resolve?slug=slug-a',
        headers: {
          'x-discovery-key': 'test-discovery-key-retry',
          'x-forwarded-for': '10.0.0.1',
        },
      })

    await req()
    const second = await req()
    expect(second.statusCode).toBe(429)
    expect(second.headers['retry-after']).toBeDefined()
    expect(Number(second.headers['retry-after'])).toBeGreaterThan(0)
  })

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

  it('sweeps stale rate-limit entries when setInterval fires after 60s', async () => {
    // Must build a fresh server AFTER vi.useFakeTimers() so the setInterval
    // inside tenant-discovery route is captured by the fake-timer system.
    vi.useFakeTimers()
    process.env.TENANT_DISCOVERY_API_KEY = 'sweep-key'
    process.env.TENANT_DISCOVERY_RATE_LIMIT_MAX = '1'
    process.env.TENANT_DISCOVERY_RATE_LIMIT_WINDOW_MS = '120000'
    mockedGetTenantPublicBySlug.mockResolvedValue({ id: 'tid', slug: 'sl' })

    const sweepApp = buildServer()
    const headers = {
      'x-discovery-key': 'sweep-key',
      'x-forwarded-for': '10.1.2.3',
    }

    const first = await sweepApp.inject({ method: 'GET', url: '/api/v1/tenants/resolve?slug=sl', headers })
    expect(first.statusCode).toBe(200)

    const blocked = await sweepApp.inject({ method: 'GET', url: '/api/v1/tenants/resolve?slug=sl', headers })
    expect(blocked.statusCode).toBe(429)

    // Advance 61 seconds — triggers the setInterval callback (SWEEP_INTERVAL_MS = 60_000).
    // sweepExpiredEntries deletes entries whose window (120 000ms) has elapsed,
    // but only 61 000ms have passed, so the entry is NOT deleted yet.
    vi.advanceTimersByTime(61_000)

    // Still blocked because the rate-limit window (120s) hasn't expired.
    const stillBlocked = await sweepApp.inject({ method: 'GET', url: '/api/v1/tenants/resolve?slug=sl', headers })
    expect(stillBlocked.statusCode).toBe(429)

    // Advance past the full window — sweep on next tick removes the stale entry.
    vi.advanceTimersByTime(70_000)

    const cleared = await sweepApp.inject({ method: 'GET', url: '/api/v1/tenants/resolve?slug=sl', headers })
    expect(cleared.statusCode).toBe(200)

    await sweepApp.close()
    vi.useRealTimers()
  })
})

import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
}))

const mockWithTenantDb = vi.hoisted(() => vi.fn())

vi.mock('@patioer/db', () => ({
  db: dbMock,
  withTenantDb: mockWithTenantDb,
  schema: {
    tenants: { id: 'id', name: 'name', slug: 'slug' },
    agents: {},
  },
}))

import onboardingRoute from './onboarding.js'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ONBOARDING_REGISTER_API_KEY = 'onboarding-secret-test'
  delete process.env.NODE_ENV
  delete process.env.APP_BASE_URL

  const mockSelectLimit = vi.fn().mockResolvedValue([])
  const mockWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit })
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
  dbMock.select.mockReturnValue({ from: mockFrom })

  const mockReturning = vi.fn().mockResolvedValue([{ id: TENANT_ID, name: 'Acme', slug: 'acme-test' }])
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning })
  dbMock.insert.mockReturnValue({ values: mockValues })

  mockWithTenantDb.mockImplementation(async (_tid: string, cb: (db: unknown) => Promise<unknown>) => {
    const tdb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }
    return cb(tdb)
  })
})

afterEach(() => {
  delete process.env.ONBOARDING_REGISTER_API_KEY
})

function buildApp() {
  const app = Fastify({ logger: false })
  app.register(onboardingRoute)
  return app
}

describe('POST /api/v1/onboarding/register', () => {
  it('returns 503 when ONBOARDING_REGISTER_API_KEY is unset', async () => {
    delete process.env.ONBOARDING_REGISTER_API_KEY
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/onboarding/register',
      headers: { 'content-type': 'application/json', 'x-onboarding-key': 'x' },
      payload: JSON.stringify({ name: 'A', slug: 'a' }),
    })
    expect(res.statusCode).toBe(503)
    await app.close()
  })

  it('returns 401 when x-onboarding-key is wrong', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/onboarding/register',
      headers: { 'content-type': 'application/json', 'x-onboarding-key': 'wrong' },
      payload: JSON.stringify({ name: 'A', slug: 'valid-slug' }),
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('returns 400 for invalid body', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/onboarding/register',
      headers: { 'content-type': 'application/json', 'x-onboarding-key': 'onboarding-secret-test' },
      payload: JSON.stringify({ name: '', slug: '!!!' }),
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('returns 409 when slug already exists', async () => {
    const mockSelectLimit = vi.fn().mockResolvedValue([{ id: 'existing' }])
    const mockWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit })
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    dbMock.select.mockReturnValue({ from: mockFrom })

    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/onboarding/register',
      headers: { 'content-type': 'application/json', 'x-onboarding-key': 'onboarding-secret-test' },
      payload: JSON.stringify({ name: 'A', slug: 'taken-slug' }),
    })
    expect(res.statusCode).toBe(409)
    expect(dbMock.insert).not.toHaveBeenCalled()
    await app.close()
  })

  it('returns 503 in production when APP_BASE_URL is not https', async () => {
    process.env.NODE_ENV = 'production'
    process.env.APP_BASE_URL = 'http://insecure.example.com'
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/onboarding/register',
      headers: { 'content-type': 'application/json', 'x-onboarding-key': 'onboarding-secret-test' },
      payload: JSON.stringify({ name: 'A', slug: 'new-slug' }),
    })
    expect(res.statusCode).toBe(503)
    await app.close()
  })

  it('returns 201 with tenantId and runs RLS verification', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/onboarding/register',
      headers: { 'content-type': 'application/json', 'x-onboarding-key': 'onboarding-secret-test' },
      payload: JSON.stringify({ name: 'Acme', slug: 'acme-new' }),
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { tenantId: string; slug: string }
    expect(body.tenantId).toBe(TENANT_ID)
    expect(body.slug).toBe('acme-test')
    expect(mockWithTenantDb).toHaveBeenCalledWith(TENANT_ID, expect.any(Function))
    await app.close()
  })
})

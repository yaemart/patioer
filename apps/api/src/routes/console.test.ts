import { describe, it, expect, beforeEach } from 'vitest'
import Fastify from 'fastify'
import consoleRoute from './console.js'

function buildTestApp() {
  const app = Fastify({ logger: false })

  app.decorateRequest('tenantId', '')
  app.decorateRequest('withDb', null)

  app.addHook('preHandler', async (request) => {
    const tenantHeader = request.headers['x-tenant-id']
    if (typeof tenantHeader === 'string') {
      ;(request as unknown as Record<string, unknown>).tenantId = tenantHeader.toLowerCase()
    }
  })

  app.register(consoleRoute)
  return app
}

describe('Console Routes', () => {
  let app: ReturnType<typeof buildTestApp>

  beforeEach(async () => {
    app = buildTestApp()
    await app.ready()
  })

  // ─── Auth Guard ─────────────────────────────────────────────────────────

  it('returns 401 without x-tenant-id for /electroos', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/console/electroos' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 without x-tenant-id for /devos', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/console/devos' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 without x-tenant-id for /dataos', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/console/dataos' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 without x-tenant-id for /approvals', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/console/approvals' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 without x-tenant-id for /overview', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/console/overview' })
    expect(res.statusCode).toBe(401)
  })

  // ─── Alert Hub ────────────────────────────────────────────────────────

  it('returns 501 for /alerts until a real backend is wired', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/console/alerts',
      headers: { 'x-tenant-id': '11111111-1111-1111-1111-111111111111' },
    })
    expect(res.statusCode).toBe(501)
    expect(JSON.parse(res.body)).toEqual({ error: 'alerts backend not configured' })
  })

  it('returns 501 for /alerts even when filters are present', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/console/alerts?severity=P0',
      headers: { 'x-tenant-id': '11111111-1111-1111-1111-111111111111' },
    })
    expect(res.statusCode).toBe(501)
    expect(JSON.parse(res.body)).toEqual({ error: 'alerts backend not configured' })
  })

  // ─── DB-dependent routes return 500 without DB ─────────────────────────

  it('returns 500 for /electroos without DB', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/console/electroos',
      headers: { 'x-tenant-id': '11111111-1111-1111-1111-111111111111' },
    })
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body).error).toBe('db unavailable')
  })

  it('returns 500 for /devos without DB', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/console/devos',
      headers: { 'x-tenant-id': '11111111-1111-1111-1111-111111111111' },
    })
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body).error).toBe('db unavailable')
  })

  it('returns 500 for /dataos without DB', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/console/dataos',
      headers: { 'x-tenant-id': '11111111-1111-1111-1111-111111111111' },
    })
    expect(res.statusCode).toBe(500)
  })

  it('returns 500 for /overview without DB', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/console/overview',
      headers: { 'x-tenant-id': '11111111-1111-1111-1111-111111111111' },
    })
    expect(res.statusCode).toBe(500)
  })

  it('returns 500 for /approvals without DB', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/console/approvals',
      headers: { 'x-tenant-id': '11111111-1111-1111-1111-111111111111' },
    })
    expect(res.statusCode).toBe(500)
  })
})

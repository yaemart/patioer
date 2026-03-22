import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import tenantPlugin from '../plugins/tenant.js'
import agentsRoute from './agents.js'
import productsRoute from './products.js'
import ordersRoute from './orders.js'
import approvalsRoute from './approvals.js'
import {
  closePool,
  seedTenantData,
  setupTwoTenants,
  teardownTwoTenants,
  type SeedResult,
  type TenantFixture,
} from '@patioer/db/testing'

const isIntegration = !!process.env.DATABASE_URL

function buildTestServer() {
  const app = Fastify({ logger: false })
  app.register(sensible)
  app.register(tenantPlugin)
  app.register(agentsRoute)
  app.register(productsRoute)
  app.register(ordersRoute)
  app.register(approvalsRoute)
  return app
}

describe.skipIf(!isIntegration)('E2E multi-tenant isolation via HTTP', () => {
  let app: ReturnType<typeof buildTestServer>
  let fix: TenantFixture
  let seedA: SeedResult
  let seedB: SeedResult

  beforeAll(async () => {
    fix = await setupTwoTenants()
    seedA = await seedTenantData(fix.tenantAId, 'http-alpha')
    seedB = await seedTenantData(fix.tenantBId, 'http-bravo')
    app = buildTestServer()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    await teardownTwoTenants(fix)
    await closePool()
  })

  // ── GET /api/v1/agents ──────────────────────────────────

  describe('GET /api/v1/agents', () => {
    it('tenant A header returns only tenant A agents', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/agents',
        headers: { 'x-tenant-id': fix.tenantAId },
      })
      expect(res.statusCode).toBe(200)
      const { agents } = res.json()
      expect(agents).toHaveLength(1)
      expect(agents[0].id).toBe(seedA.agentId)
    })

    it('tenant B header returns only tenant B agents', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/agents',
        headers: { 'x-tenant-id': fix.tenantBId },
      })
      expect(res.statusCode).toBe(200)
      const { agents } = res.json()
      expect(agents).toHaveLength(1)
      expect(agents[0].id).toBe(seedB.agentId)
    })

    it('tenant A cannot read tenant B agent by id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/agents/${seedB.agentId}`,
        headers: { 'x-tenant-id': fix.tenantAId },
      })
      expect(res.statusCode).toBe(404)
    })
  })

  // ── GET /api/v1/products ────────────────────────────────

  describe('GET /api/v1/products', () => {
    it('tenant A header returns only tenant A products', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/products',
        headers: { 'x-tenant-id': fix.tenantAId },
      })
      expect(res.statusCode).toBe(200)
      const { products } = res.json()
      expect(products).toHaveLength(1)
      expect(products[0].id).toBe(seedA.productId)
    })

    it('tenant B header returns only tenant B products', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/products',
        headers: { 'x-tenant-id': fix.tenantBId },
      })
      expect(res.statusCode).toBe(200)
      const { products } = res.json()
      expect(products).toHaveLength(1)
      expect(products[0].id).toBe(seedB.productId)
    })
  })

  // ── GET /api/v1/orders ──────────────────────────────────

  describe('GET /api/v1/orders', () => {
    it('tenant A header returns only tenant A orders', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/orders',
        headers: { 'x-tenant-id': fix.tenantAId },
      })
      expect(res.statusCode).toBe(200)
      const { orders } = res.json()
      expect(orders).toHaveLength(1)
      expect(orders[0].id).toBe(seedA.orderId)
    })
  })

  // ── GET /api/v1/approvals ───────────────────────────────

  describe('GET /api/v1/approvals', () => {
    it('tenant A header returns only tenant A approvals', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/approvals',
        headers: { 'x-tenant-id': fix.tenantAId },
      })
      expect(res.statusCode).toBe(200)
      const { approvals } = res.json()
      expect(approvals).toHaveLength(1)
      expect(approvals[0].id).toBe(seedA.approvalId)
    })

    it('tenant B cannot resolve tenant A approval', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/approvals/${seedA.approvalId}/resolve`,
        headers: { 'x-tenant-id': fix.tenantBId },
        payload: { status: 'approved', resolvedBy: 'attacker' },
      })
      expect(res.statusCode).toBe(404)
    })
  })

  // ── missing / invalid x-tenant-id ──────────────────────

  describe('missing x-tenant-id', () => {
    it('GET /api/v1/agents returns 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/agents' })
      expect(res.statusCode).toBe(401)
    })

    it('GET /api/v1/products returns 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/products' })
      expect(res.statusCode).toBe(401)
    })

    it('GET /api/v1/approvals returns 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/approvals' })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('invalid x-tenant-id', () => {
    it('returns 400 for non-uuid tenant id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/agents',
        headers: { 'x-tenant-id': 'not-a-uuid' },
      })
      expect(res.statusCode).toBe(400)
    })
  })
})

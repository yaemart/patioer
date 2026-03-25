import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import tenantPlugin from '../plugins/tenant.js'
import agentsRoute from './agents.js'
import productsRoute from './products.js'
import ordersRoute from './orders.js'
import {
  closePool,
  seedTenantData,
  teardownTwoTenants,
  type SeedResult,
  type TenantFixture,
} from '@patioer/db/testing'
import { setupTwoTenants } from '@patioer/db/testing'

const isIntegration = !!process.env.DATABASE_URL
const TENANT_COUNT = 10
const ROUNDS = 3

function buildTestServer() {
  const app = Fastify({ logger: false })
  app.register(sensible)
  app.register(tenantPlugin)
  app.register(agentsRoute)
  app.register(productsRoute)
  app.register(ordersRoute)
  return app
}

type TenantCase = {
  tenantId: string
  seed: SeedResult
  fixture: TenantFixture
}

const platformPlan = [
  { credentialsPlatforms: ['shopify', 'amazon'], dataPlatform: 'amazon' as const },
  { credentialsPlatforms: ['tiktok', 'shopee'], dataPlatform: 'tiktok' as const },
  { credentialsPlatforms: ['shopify', 'amazon'], dataPlatform: 'shopify' as const },
  { credentialsPlatforms: ['tiktok', 'shopee'], dataPlatform: 'shopee' as const },
]

describe.skipIf(!isIntegration)('E2E 10-tenant concurrency isolation', () => {
  let app: ReturnType<typeof buildTestServer>
  const cases: TenantCase[] = []

  beforeAll(async () => {
    // Build 10 tenants by composing 5 two-tenant fixtures.
    for (let i = 0; i < TENANT_COUNT / 2; i += 1) {
      const fix = await setupTwoTenants()
      const planA = platformPlan[(i * 2) % platformPlan.length]!
      const planB = platformPlan[(i * 2 + 1) % platformPlan.length]!
      const seedA = await seedTenantData(fix.tenantAId, `concurrency-a-${i}`, {
        ...planA,
        agentCount: 5,
      })
      const seedB = await seedTenantData(fix.tenantBId, `concurrency-b-${i}`, {
        ...planB,
        agentCount: 5,
      })
      cases.push({ tenantId: fix.tenantAId, seed: seedA, fixture: fix })
      cases.push({ tenantId: fix.tenantBId, seed: seedB, fixture: fix })
    }

    app = buildTestServer()
    await app.ready()
  })

  afterAll(async () => {
    // teardownTwoTenants expects one fixture at a time.
    const seen = new Set<string>()
    for (const c of cases) {
      const key = `${c.fixture.tenantAId}:${c.fixture.tenantBId}`
      if (seen.has(key)) continue
      seen.add(key)
      await teardownTwoTenants(c.fixture)
    }
    await app.close()
    await closePool()
  })

  it(`runs ${ROUNDS} rounds with ${TENANT_COUNT} tenants concurrently and no data mixing`, async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      await Promise.all(
        cases.map(async ({ tenantId, seed }) => {
          const [agentsRes, productsRes, ordersRes] = await Promise.all([
            app.inject({
              method: 'GET',
              url: '/api/v1/agents',
              headers: { 'x-tenant-id': tenantId },
            }),
            app.inject({
              method: 'GET',
              url: '/api/v1/products',
              headers: { 'x-tenant-id': tenantId },
            }),
            app.inject({
              method: 'GET',
              url: '/api/v1/orders',
              headers: { 'x-tenant-id': tenantId },
            }),
          ])

          expect(agentsRes.statusCode).toBe(200)
          const { agents } = agentsRes.json()
          expect(agents).toHaveLength(5)
          expect(agents.map((a: { id: string }) => a.id).sort()).toEqual(seed.agentIds.slice().sort())

          expect(productsRes.statusCode).toBe(200)
          const { products } = productsRes.json()
          expect(products).toHaveLength(1)
          expect(products[0].id).toBe(seed.productId)

          expect(ordersRes.statusCode).toBe(200)
          const { orders } = ordersRes.json()
          expect(orders).toHaveLength(1)
          expect(orders[0].id).toBe(seed.orderId)
        }),
      )
    }
  })

  it('tenant A cannot fetch tenant B agent id under concurrent fixture', async () => {
    const tenantA = cases[0]!
    const tenantB = cases[1]!
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${tenantB.seed.agentId}`,
      headers: { 'x-tenant-id': tenantA.tenantId },
    })
    expect(res.statusCode).toBe(404)
  })
})

import { afterAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
// Integration cleanup uses global db for tenants row (no HTTP request context).
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { db, schema } from '@patioer/db'
import { eq } from 'drizzle-orm'
import onboardingRoute from './onboarding.js'

const isIntegration = !!process.env.DATABASE_URL

describe.skipIf(!isIntegration)('Onboarding register (integration)', () => {
  const key = 'integration-onboarding-key'
  let createdTenantId: string | null = null

  afterAll(async () => {
    if (createdTenantId) {
      await db.delete(schema.tenants).where(eq(schema.tenants.id, createdTenantId))
    }
  })

  it('creates tenant and verifies RLS read', async () => {
    process.env.ONBOARDING_REGISTER_API_KEY = key
    delete process.env.NODE_ENV

    const app = Fastify({ logger: false })
    await app.register(onboardingRoute)
    await app.ready()

    const slug = `onb-${Date.now().toString(36)}`
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/onboarding/register',
      headers: { 'content-type': 'application/json', 'x-onboarding-key': key },
      payload: JSON.stringify({ name: 'Integration Co', slug }),
    })

    expect(res.statusCode).toBe(201)
    const body = res.json() as { tenantId: string; slug: string }
    createdTenantId = body.tenantId
    expect(body.slug).toBe(slug)

    const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, body.tenantId)).limit(1)
    expect(row?.slug).toBe(slug)

    await app.close()
  })
})

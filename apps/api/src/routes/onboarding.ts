import { timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
// `tenants` insert/slug check is intentionally global (no RLS tenant session yet); other routes use withTenantDb.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- see above
import { db, schema, withTenantDb } from '@patioer/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { runOnboardingHealthProbe } from '../lib/onboarding-health-probe.js'
import { defaultAgentSpecs, seedDefaultAgents } from '../lib/seed-default-agents.js'

const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/)

const registerBodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
})

function safeCompare(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Sprint 4 Day 8 — Onboarding Step 1: create a tenant row (no RLS on `tenants`).
 * Step 2 (Shopify OAuth) uses existing `GET /api/v1/shopify/auth` + callback with `x-tenant-id`.
 */
const onboardingRoute: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/onboarding/register', {
    schema: {
      tags: ['Onboarding'],
      summary: 'Register a new tenant (Step 1)',
      description:
        'Requires `x-onboarding-key` matching `ONBOARDING_REGISTER_API_KEY`. Returns `tenantId` for subsequent OAuth (send as `x-tenant-id` to Shopify routes).',
    },
  }, async (request, reply) => {
    const configuredKey = process.env.ONBOARDING_REGISTER_API_KEY
    if (!configuredKey) {
      return reply.code(503).send({ error: 'onboarding registration is disabled' })
    }

    const presented = request.headers['x-onboarding-key']
    if (typeof presented !== 'string' || !safeCompare(presented, configuredKey)) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    if (process.env.NODE_ENV === 'production') {
      const base = process.env.APP_BASE_URL
      if (!base || !base.startsWith('https://')) {
        return reply
          .code(503)
          .send({ error: 'APP_BASE_URL must be set to an https URL in production for OAuth callbacks' })
      }
    }

    const parsed = registerBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid request body' })
    }
    const { name, slug } = parsed.data

    const [existing] = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug))
      .limit(1)
    if (existing) {
      return reply.code(409).send({ error: 'slug already taken' })
    }

    const [tenant] = await db.insert(schema.tenants).values({ name, slug }).returning()
    if (!tenant) {
      return reply.code(500).send({ error: 'failed to create tenant' })
    }

    try {
      await withTenantDb(tenant.id, async (tdb) => {
        await tdb.select().from(schema.agents).limit(1)
      })
    } catch (err) {
      request.log.error({ err, tenantId: tenant.id }, 'onboarding.rls_verification_failed')
      return reply.code(500).send({ error: 'tenant RLS verification failed' })
    }

    request.log.info({ tenantId: tenant.id, slug: tenant.slug }, 'onboarding.tenant_created')

    return reply.code(201).send({
      tenantId: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
    })
  })

  /** Step 3 — idempotent seed of five default agents + optional Paperclip heartbeats (Sprint 4 Day 9). */
  app.post('/api/v1/onboarding/initialize-agents', {
    schema: {
      tags: ['Onboarding'],
      summary: 'Initialize default agents (Step 3)',
      security: [{ tenantId: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    try {
      const result = await seedDefaultAgents({
        tenantId: request.tenantId,
        appBaseUrl: process.env.APP_BASE_URL,
      })
      request.log.info(
        { tenantId: request.tenantId, created: result.created.length, registered: result.registered.length },
        'onboarding.initialize_agents',
      )
      return reply.send({
        ...result,
        expectedTypes: defaultAgentSpecs().map((s) => s.type),
      })
    } catch (err) {
      request.log.error({ err, tenantId: request.tenantId }, 'onboarding.initialize_agents_failed')
      return reply.code(500).send({ error: 'failed to seed agents' })
    }
  })

  /** Step 4 — Harness per platform + Paperclip canary heartbeat (Task 4.10 / Day 11). */
  app.get('/api/v1/onboarding/health', {
    schema: {
      tags: ['Onboarding'],
      summary: 'Onboarding health (platforms + agentHeartbeats + agents)',
      security: [{ tenantId: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }
    const body = await runOnboardingHealthProbe({
      tenantId: request.tenantId,
      withDb: request.withDb,
      log: request.log,
    })
    return reply.send(body)
  })
}

export default onboardingRoute

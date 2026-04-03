import type { FastifyPluginAsync } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import { schema } from '@patioer/db'
import { AmazonHealthHarness } from '@patioer/harness'

const accountHealthRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/account-health', async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'Authentication required' })
    }
    const tenantId = request.tenantId

    const events = await request.withDb(async (db) =>
      db
        .select()
        .from(schema.accountHealthEvents)
        .where(eq(schema.accountHealthEvents.tenantId, tenantId))
        .orderBy(desc(schema.accountHealthEvents.createdAt))
        .limit(200),
    )

    const critical = events.filter((e) => e.severity === 'critical').length
    const warning = events.filter((e) => e.severity === 'warning').length
    const resolved = events.filter((e) => e.resolvedAt !== null).length

    return reply.send({
      total: events.length,
      critical,
      warning,
      resolved,
      events: events.map((e) => ({
        id: e.id,
        tenantId: e.tenantId,
        platform: e.platform,
        eventType: e.eventType,
        severity: e.severity,
        message: e.description ?? e.title,
        asin: e.affectedEntity,
        resolvedAt: e.resolvedAt?.toISOString() ?? null,
        createdAt: e.createdAt?.toISOString() ?? new Date().toISOString(),
      })),
    })
  })

  app.get('/api/v1/account-health/summary', async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'Authentication required' })
    }
    const tenantId = request.tenantId

    const events = await request.withDb(async (db) =>
      db
        .select()
        .from(schema.accountHealthEvents)
        .where(eq(schema.accountHealthEvents.tenantId, tenantId))
        .limit(500),
    )

    const openCritical = events.filter((e) => e.severity === 'critical' && !e.resolvedAt).length
    const openWarning = events.filter((e) => e.severity === 'warning' && !e.resolvedAt).length
    const resolvedCount = events.filter((e) => e.resolvedAt !== null).length
    const overallStatus = openCritical > 0 ? 'critical' : openWarning > 0 ? 'at_risk' : 'healthy'

    const harness = new AmazonHealthHarness()
    const harnessHealth = await harness.getAccountHealth()

    return reply.send({
      overallStatus,
      openIssues: openCritical + openWarning,
      resolvedLast30d: resolvedCount,
      harnessMetrics: harnessHealth,
    })
  })

  app.get('/api/v1/account-health/listing-issues', async (request, reply) => {
    if (!request.tenantId) {
      return reply.code(401).send({ error: 'Authentication required' })
    }
    const harness = new AmazonHealthHarness()
    const issues = await harness.getListingIssues()
    return reply.send({ issues })
  })

  app.get('/api/v1/account-health/buybox', async (request, reply) => {
    if (!request.tenantId) {
      return reply.code(401).send({ error: 'Authentication required' })
    }
    const harness = new AmazonHealthHarness()
    const entries = await harness.getBuyBoxStatus()
    return reply.send({ entries })
  })
}

export default accountHealthRoute

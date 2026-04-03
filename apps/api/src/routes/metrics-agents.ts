import type { FastifyPluginAsync } from 'fastify'
import { and, count, eq, gte, sql } from 'drizzle-orm'
import { schema } from '@patioer/db'

const metricsAgentsRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/metrics/agents', {
    schema: {
      tags: ['Metrics'],
      summary: 'Agent decision quality metrics (Phase 6 compatible)',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'x-tenant-id required' })
    }

    const tenantId = request.tenantId
    const now = new Date()
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const metrics = await request.withDb(async (db) => {
      const [totalDecisions24h] = await db
        .select({ cnt: count() })
        .from(schema.agentEvents)
        .where(and(
          eq(schema.agentEvents.tenantId, tenantId),
          sql`${schema.agentEvents.action} LIKE '%.pipeline.completed'`,
          gte(schema.agentEvents.createdAt, dayAgo),
        ))

      const [totalDecisions7d] = await db
        .select({ cnt: count() })
        .from(schema.agentEvents)
        .where(and(
          eq(schema.agentEvents.tenantId, tenantId),
          sql`${schema.agentEvents.action} LIKE '%.pipeline.completed'`,
          gte(schema.agentEvents.createdAt, weekAgo),
        ))

      const [harnessErrors24h] = await db
        .select({ cnt: count() })
        .from(schema.agentEvents)
        .where(and(
          eq(schema.agentEvents.tenantId, tenantId),
          eq(schema.agentEvents.action, 'agent.execute.harness_error'),
          gte(schema.agentEvents.createdAt, dayAgo),
        ))

      const [pendingApprovals] = await db
        .select({ cnt: count() })
        .from(schema.approvals)
        .where(and(
          eq(schema.approvals.tenantId, tenantId),
          eq(schema.approvals.status, 'pending'),
        ))

      const [activeSops] = await db
        .select({ cnt: count() })
        .from(schema.tenantSops)
        .where(and(
          eq(schema.tenantSops.tenantId, tenantId),
          eq(schema.tenantSops.status, 'active'),
        ))

      const [activeScenarios] = await db
        .select({ cnt: count() })
        .from(schema.tenantSopScenarios)
        .where(and(
          eq(schema.tenantSopScenarios.tenantId, tenantId),
          eq(schema.tenantSopScenarios.status, 'active'),
        ))

      const totalPipeline24h = totalDecisions24h?.cnt ?? 0
      const totalHarnessErrors24h = harnessErrors24h?.cnt ?? 0
      const errorRate = totalPipeline24h > 0
        ? totalHarnessErrors24h / (totalPipeline24h + totalHarnessErrors24h)
        : 0

      return {
        decisions: {
          last24h: totalPipeline24h,
          last7d: totalDecisions7d?.cnt ?? 0,
        },
        harnessApiErrorRate: Math.round(errorRate * 10000) / 10000,
        pendingApprovals: pendingApprovals?.cnt ?? 0,
        sop: {
          activeSopCount: activeSops?.cnt ?? 0,
          activeScenarioCount: activeScenarios?.cnt ?? 0,
        },
      }
    })

    return reply.send({
      ...metrics,
      checkedAt: now.toISOString(),
    })
  })
}

export default metricsAgentsRoute

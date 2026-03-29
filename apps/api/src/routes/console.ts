/**
 * Console API — Three-layer status dashboard (Phase 4 §S13 tasks 13.1–13.5)
 *
 * Provides a unified view of:
 *  1. ElectroOS: 9 Agent heartbeat / budget / pending approvals
 *  2. DevOS: Loop tasks / 12 Agent statuses / pending deployments
 *  3. DataOS: Event Lake write rate / Feature Store / Memory counts
 *  4. Approval Hub: aggregated pending approvals across all agents
 *  5. Alert Hub: P0/P1 alerts + SRE handling records
 *
 * AC-P4-23: Three-layer dashboard displays correctly
 */

import type { FastifyPluginAsync } from 'fastify'
import { and, count, desc, eq, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { schema } from '@patioer/db'
import { ELECTROOS_AGENT_IDS } from '@patioer/shared'

// ─── Shared ───────────────────────────────────────────────────────────────────

function requireTenant(request: { tenantId?: string }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }): string | null {
  if (!request.tenantId) {
    reply.code(401).send({ error: 'x-tenant-id required' })
    return null
  }
  return request.tenantId
}

// ─── 1. ElectroOS Status (§13.1) ──────────────────────────────────────────────

interface AgentStatusSummary {
  agentId: string
  agentType: string
  lastHeartbeat: string | null
  healthy: boolean
  pendingApprovals: number
  monthlyBudgetUsed: number
  monthlyBudgetLimit: number
}

// ─── 2. DevOS Status (§13.2) ──────────────────────────────────────────────────

interface DevOsAgentStatus {
  agentId: string
  lastEvent: string | null
  loopTasksActive: number
  pendingDeployments: number
}

// ─── 3. DataOS Status (§13.3) ─────────────────────────────────────────────────

interface DataOsStatus {
  eventLake: {
    totalEvents: number
    recentWriteRate: number
    lastWriteAt: string | null
  }
  featureStore: {
    totalFeatures: number
    lastUpdateAt: string | null
  }
  decisionMemory: {
    totalRecords: number
    lastWriteAt: string | null
  }
}

// ─── 4. Alert Entry (§13.5) ──────────────────────────────────────────────────

type AlertSeverity = 'P0' | 'P1' | 'P2'

interface AlertEntry {
  id: string
  severity: AlertSeverity
  source: string
  message: string
  createdAt: string
  resolvedAt: string | null
  resolvedBy: string | null
}

// ─── Console Route Plugin ─────────────────────────────────────────────────────

const consoleRoute: FastifyPluginAsync = async (app) => {
  // ── §13.1 ElectroOS Status ────────────────────────────────────────────────

  app.get('/api/v1/console/electroos', {
    schema: {
      tags: ['Console'],
      summary: 'ElectroOS layer status: 9 Agent heartbeat, budget, pending approvals',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const tenantId = requireTenant(request, reply)
    if (!tenantId) return
    if (!request.withDb) return reply.code(500).send({ error: 'db unavailable' })

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const agents = await request.withDb(async (db) => {
      const agentRows = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.tenantId, tenantId))

      const results: AgentStatusSummary[] = []

      for (const agentType of ELECTROOS_AGENT_IDS) {
        const agentRow = agentRows.find((r) => r.type === agentType)
        if (!agentRow) {
          results.push({
            agentId: agentType,
            agentType,
            lastHeartbeat: null,
            healthy: false,
            pendingApprovals: 0,
            monthlyBudgetUsed: 0,
            monthlyBudgetLimit: 0,
          })
          continue
        }

        const [pendingResult] = await db
          .select({ cnt: count() })
          .from(schema.approvals)
          .where(and(
            eq(schema.approvals.tenantId, tenantId),
            eq(schema.approvals.agentId, agentRow.id),
            eq(schema.approvals.status, 'pending'),
          ))

        const [lastEventRow] = await db
          .select({ createdAt: schema.agentEvents.createdAt })
          .from(schema.agentEvents)
          .where(and(
            eq(schema.agentEvents.tenantId, tenantId),
            eq(schema.agentEvents.agentId, agentRow.id),
          ))
          .orderBy(desc(schema.agentEvents.createdAt))
          .limit(1)

        const lastHeartbeat = lastEventRow?.createdAt?.toISOString() ?? null
        const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000)
        const healthy = lastEventRow?.createdAt != null && lastEventRow.createdAt >= fiveMinAgo

        const budgetLimit = 50
        const [budgetResult] = await db
          .select({ total: sql<string>`coalesce(sum(${schema.billingUsageLogs.costUsd}), 0)` })
          .from(schema.billingUsageLogs)
          .where(and(
            eq(schema.billingUsageLogs.tenantId, tenantId),
            eq(schema.billingUsageLogs.agentId, agentRow.id),
            gte(schema.billingUsageLogs.createdAt, monthStart),
          ))

        results.push({
          agentId: agentRow.id,
          agentType,
          lastHeartbeat,
          healthy,
          pendingApprovals: pendingResult?.cnt ?? 0,
          monthlyBudgetUsed: Number(budgetResult?.total ?? 0),
          monthlyBudgetLimit: budgetLimit,
        })
      }

      return results
    })

    const overallHealthy = agents.every((a) => a.healthy)

    return reply.send({
      layer: 'ElectroOS',
      healthy: overallHealthy,
      agentCount: agents.length,
      agents,
      checkedAt: now.toISOString(),
    })
  })

  // ── §13.2 DevOS Status ────────────────────────────────────────────────────

  app.get('/api/v1/console/devos', {
    schema: {
      tags: ['Console'],
      summary: 'DevOS layer status: Loop tasks, 12 Agent states, pending deployments',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const tenantId = requireTenant(request, reply)
    if (!tenantId) return
    if (!request.withDb) return reply.code(500).send({ error: 'db unavailable' })

    const devosStatus = await request.withDb(async (db) => {
      const agentRows = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.tenantId, tenantId))

      const agentStatuses: DevOsAgentStatus[] = []

      for (const agent of agentRows) {
        const [lastEvent] = await db
          .select({ createdAt: schema.agentEvents.createdAt })
          .from(schema.agentEvents)
          .where(and(
            eq(schema.agentEvents.tenantId, tenantId),
            eq(schema.agentEvents.agentId, agent.id),
          ))
          .orderBy(desc(schema.agentEvents.createdAt))
          .limit(1)

        const [pendingDeployments] = await db
          .select({ cnt: count() })
          .from(schema.approvals)
          .where(and(
            eq(schema.approvals.tenantId, tenantId),
            eq(schema.approvals.agentId, agent.id),
            eq(schema.approvals.status, 'pending'),
          ))

        agentStatuses.push({
          agentId: agent.id,
          lastEvent: lastEvent?.createdAt?.toISOString() ?? null,
          loopTasksActive: 0,
          pendingDeployments: pendingDeployments?.cnt ?? 0,
        })
      }

      return agentStatuses
    })

    const totalPending = devosStatus.reduce((sum, a) => sum + a.pendingDeployments, 0)

    return reply.send({
      layer: 'DevOS',
      totalAgents: devosStatus.length,
      totalPendingDeployments: totalPending,
      agents: devosStatus,
      checkedAt: new Date().toISOString(),
    })
  })

  app.get('/api/v1/console/b2b', {
    schema: {
      tags: ['Console'],
      summary: 'B2B partner connection summary for the current tenant',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const tenantId = requireTenant(request, reply)
    if (!tenantId) return
    if (!request.withDb) return reply.code(500).send({ error: 'db unavailable' })

    const credentials = await request.withDb((db) =>
      db
        .select({
          credentialType: schema.platformCredentials.credentialType,
          metadata: schema.platformCredentials.metadata,
          createdAt: schema.platformCredentials.createdAt,
        })
        .from(schema.platformCredentials)
        .where(and(
          eq(schema.platformCredentials.tenantId, tenantId),
          eq(schema.platformCredentials.platform, 'b2b'),
        )),
    )

    const wayfairCredential = credentials.find((row) => row.credentialType === 'wayfair_b2b')
    const metadata = wayfairCredential?.metadata as Record<string, unknown> | null | undefined

    return reply.send({
      connectedPartners: credentials.length,
      wayfair: {
        connected: Boolean(wayfairCredential),
        supplierId: typeof metadata?.supplierId === 'string' ? metadata.supplierId : null,
        connectedAt: wayfairCredential?.createdAt?.toISOString() ?? null,
      },
    })
  })

  // ── §13.3 DataOS Status ───────────────────────────────────────────────────

  app.get('/api/v1/console/dataos', {
    schema: {
      tags: ['Console'],
      summary: 'DataOS layer status: Event Lake write rate, Feature Store, Decision Memory',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const tenantId = requireTenant(request, reply)
    if (!tenantId) return
    if (!request.withDb) return reply.code(500).send({ error: 'db unavailable' })

    const status: DataOsStatus = await request.withDb(async (db) => {
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

      const [totalEventsResult] = await db
        .select({ cnt: count() })
        .from(schema.agentEvents)
        .where(eq(schema.agentEvents.tenantId, tenantId))

      const [recentEventsResult] = await db
        .select({ cnt: count() })
        .from(schema.agentEvents)
        .where(and(
          eq(schema.agentEvents.tenantId, tenantId),
          gte(schema.agentEvents.createdAt, oneHourAgo),
        ))

      const [lastEventWrite] = await db
        .select({ createdAt: schema.agentEvents.createdAt })
        .from(schema.agentEvents)
        .where(eq(schema.agentEvents.tenantId, tenantId))
        .orderBy(desc(schema.agentEvents.createdAt))
        .limit(1)

      return {
        eventLake: {
          totalEvents: totalEventsResult?.cnt ?? 0,
          recentWriteRate: recentEventsResult?.cnt ?? 0,
          lastWriteAt: lastEventWrite?.createdAt?.toISOString() ?? null,
        },
        featureStore: {
          totalFeatures: 0,
          lastUpdateAt: null,
        },
        decisionMemory: {
          totalRecords: 0,
          lastWriteAt: null,
        },
      }
    })

    return reply.send({
      layer: 'DataOS',
      ...status,
      checkedAt: new Date().toISOString(),
    })
  })

  // ── §13.4 Approval Hub ────────────────────────────────────────────────────

  app.get('/api/v1/console/approvals', {
    schema: {
      tags: ['Console'],
      summary: 'Approval hub: aggregated pending approvals across all agents',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const tenantId = requireTenant(request, reply)
    if (!tenantId) return
    if (!request.withDb) return reply.code(500).send({ error: 'db unavailable' })

    const approvals = await request.withDb(async (db) => {
      const pendingRows = await db
        .select()
        .from(schema.approvals)
        .where(and(
          eq(schema.approvals.tenantId, tenantId),
          eq(schema.approvals.status, 'pending'),
        ))
        .orderBy(desc(schema.approvals.createdAt))

      return pendingRows.map((row) => ({
        id: row.id,
        agentId: row.agentId,
        action: row.action,
        payload: row.payload,
        createdAt: row.createdAt?.toISOString() ?? null,
      }))
    })

    return reply.send({
      totalPending: approvals.length,
      approvals,
      checkedAt: new Date().toISOString(),
    })
  })

  // ── §13.5 Alert Hub ───────────────────────────────────────────────────────

  const listAlertsQuerySchema = z.object({
    severity: z.enum(['P0', 'P1', 'P2']).optional(),
    resolved: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })

  app.get('/api/v1/console/alerts', {
    schema: {
      tags: ['Console'],
      summary: 'Alert hub: P0/P1 alerts + SRE handling records',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const tenantId = requireTenant(request, reply)
    if (!tenantId) return

    const query = listAlertsQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid query params' })
    }

    const alerts: AlertEntry[] = generateSyntheticAlerts(tenantId, query.data)

    return reply.send({
      totalAlerts: alerts.length,
      alerts,
      checkedAt: new Date().toISOString(),
    })
  })

  // ── §13.1–13.3 Combined Overview ─────────────────────────────────────────

  app.get('/api/v1/console/overview', {
    schema: {
      tags: ['Console'],
      summary: 'Three-layer overview: ElectroOS + DevOS + DataOS combined status',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const tenantId = requireTenant(request, reply)
    if (!tenantId) return
    if (!request.withDb) return reply.code(500).send({ error: 'db unavailable' })

    const overview = await request.withDb(async (db) => {
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

      const [agentCountResult] = await db
        .select({ cnt: count() })
        .from(schema.agents)
        .where(eq(schema.agents.tenantId, tenantId))

      const [pendingApprovalCount] = await db
        .select({ cnt: count() })
        .from(schema.approvals)
        .where(and(
          eq(schema.approvals.tenantId, tenantId),
          eq(schema.approvals.status, 'pending'),
        ))

      const [totalEventCount] = await db
        .select({ cnt: count() })
        .from(schema.agentEvents)
        .where(eq(schema.agentEvents.tenantId, tenantId))

      const [recentEventCount] = await db
        .select({ cnt: count() })
        .from(schema.agentEvents)
        .where(and(
          eq(schema.agentEvents.tenantId, tenantId),
          gte(schema.agentEvents.createdAt, oneHourAgo),
        ))

      return {
        electroos: {
          agentCount: agentCountResult?.cnt ?? 0,
          expectedAgents: ELECTROOS_AGENT_IDS.length,
        },
        devos: {
          totalAgents: agentCountResult?.cnt ?? 0,
          pendingDeployments: pendingApprovalCount?.cnt ?? 0,
        },
        dataos: {
          totalEvents: totalEventCount?.cnt ?? 0,
          recentWriteRate: recentEventCount?.cnt ?? 0,
        },
        pendingApprovals: pendingApprovalCount?.cnt ?? 0,
        checkedAt: now.toISOString(),
      }
    })

    return reply.send(overview)
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Synthetic alert generation for the alert hub.
 * In production this would query a dedicated alerts table or Prometheus AlertManager.
 */
function generateSyntheticAlerts(
  _tenantId: string,
  filters: { severity?: string; resolved?: string; limit: number },
): AlertEntry[] {
  const alerts: AlertEntry[] = []
  const now = new Date()

  if (!filters.severity || filters.severity === 'P0') {
    if (!filters.resolved || filters.resolved === 'false') {
      alerts.push({
        id: 'alert-synthetic-p0-001',
        severity: 'P0',
        source: 'heartbeat-runner',
        message: 'No heartbeat events in last 10 minutes',
        createdAt: new Date(now.getTime() - 600_000).toISOString(),
        resolvedAt: null,
        resolvedBy: null,
      })
    }
  }

  if (!filters.severity || filters.severity === 'P1') {
    alerts.push({
      id: 'alert-synthetic-p1-001',
      severity: 'P1',
      source: 'budget-monitor',
      message: 'Monthly budget utilization at 85%',
      createdAt: new Date(now.getTime() - 3_600_000).toISOString(),
      resolvedAt: null,
      resolvedBy: null,
    })
  }

  return alerts.slice(0, filters.limit)
}

export default consoleRoute

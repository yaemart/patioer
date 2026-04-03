/**
 * Console API — trusted tenant operations overview.
 *
 * The console should expose only fields we can back with real storage/query
 * paths. Avoid placeholder counters or synthetic alert payloads here.
 */

import type { FastifyPluginAsync } from 'fastify'
import { and, count, desc, eq, gte, sql } from 'drizzle-orm'
import { schema, type AppDb } from '@patioer/db'
import { ELECTROOS_AGENT_IDS } from '@patioer/shared'
import { buildBusinessPortDeps } from '../lib/business-ports.js'

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
}

// ─── 3. DataOS Status (§13.3) ─────────────────────────────────────────────────

interface DataOsStatus {
  eventLake: {
    totalEvents: number
    recentWriteRate: number
    lastWriteAt: string | null
  }
}

interface ConsoleOverview {
  electroos: {
    agentCount: number
    expectedAgents: number
    healthyAgents: number
    pendingApprovals: number
  }
  devos: {
    totalAgents: number
    openTickets: number
  }
  dataos: DataOsStatus['eventLake']
  checkedAt: string
}

async function loadElectroOsStatus(
  db: AppDb,
  tenantId: string,
  now: Date,
): Promise<{ healthy: boolean; agentCount: number; agents: AgentStatusSummary[] }> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const agentRows = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.tenantId, tenantId))

  const results: AgentStatusSummary[] = []

  for (const agentType of ELECTROOS_AGENT_IDS) {
    const agentRow = agentRows.find((row) => row.type === agentType)
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

  return {
    healthy: results.every((agent) => agent.healthy),
    agentCount: results.length,
    agents: results,
  }
}

async function loadDevOsStatus(
  db: AppDb,
  tenantId: string,
): Promise<{ totalAgents: number; openTickets: number; agents: DevOsAgentStatus[] }> {
  const agentRows = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.tenantId, tenantId))

  const [openTicketsRow] = await db
    .select({ cnt: count() })
    .from(schema.devosTickets)
    .where(and(
      eq(schema.devosTickets.tenantId, tenantId),
      eq(schema.devosTickets.status, 'open'),
    ))

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

    agentStatuses.push({
      agentId: agent.id,
      lastEvent: lastEvent?.createdAt?.toISOString() ?? null,
    })
  }

  return {
    totalAgents: agentStatuses.length,
    openTickets: openTicketsRow?.cnt ?? 0,
    agents: agentStatuses,
  }
}

async function loadDataOsStatus(
  db: AppDb,
  tenantId: string,
  now: Date,
): Promise<DataOsStatus> {
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
  }
}

async function buildConsoleOverview(
  db: AppDb,
  tenantId: string,
  now: Date,
): Promise<ConsoleOverview> {
  const [electroos, devos, dataos] = await Promise.all([
    loadElectroOsStatus(db, tenantId, now),
    loadDevOsStatus(db, tenantId),
    loadDataOsStatus(db, tenantId, now),
  ])

  return {
    electroos: {
      agentCount: electroos.agentCount,
      expectedAgents: ELECTROOS_AGENT_IDS.length,
      healthyAgents: electroos.agents.filter((agent) => agent.healthy).length,
      pendingApprovals: electroos.agents.reduce((sum, agent) => sum + agent.pendingApprovals, 0),
    },
    devos: {
      totalAgents: devos.totalAgents,
      openTickets: devos.openTickets,
    },
    dataos: dataos.eventLake,
    checkedAt: now.toISOString(),
  }
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
    const electroos = await request.withDb((db) => loadElectroOsStatus(db, tenantId, now))

    return reply.send({
      layer: 'ElectroOS',
      healthy: electroos.healthy,
      agentCount: electroos.agentCount,
      agents: electroos.agents,
      checkedAt: now.toISOString(),
    })
  })

  // ── §13.2 DevOS Status ────────────────────────────────────────────────────

  app.get('/api/v1/console/devos', {
    schema: {
      tags: ['Console'],
      summary: 'DevOS layer status backed by agent events and open DevOS tickets',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const tenantId = requireTenant(request, reply)
    if (!tenantId) return
    if (!request.withDb) return reply.code(500).send({ error: 'db unavailable' })

    const devos = await request.withDb((db) => loadDevOsStatus(db, tenantId))

    return reply.send({
      layer: 'DevOS',
      totalAgents: devos.totalAgents,
      openTickets: devos.openTickets,
      agents: devos.agents,
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
      summary: 'DataOS layer status backed by Event Lake writes',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const tenantId = requireTenant(request, reply)
    if (!tenantId) return
    if (!request.withDb) return reply.code(500).send({ error: 'db unavailable' })

    const now = new Date()
    const status = await request.withDb((db) => loadDataOsStatus(db, tenantId, now))

    return reply.send({
      layer: 'DataOS',
      ...status,
      checkedAt: now.toISOString(),
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

  app.get('/api/v1/console/alerts', {
    schema: {
      tags: ['Console'],
      summary: 'Active alerts from account health events and inventory warnings',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const tenantId = requireTenant(request, reply)
    if (!tenantId) return
    if (!request.withDb) return reply.code(500).send({ error: 'db unavailable' })

    const business = buildBusinessPortDeps(request)
    const [listingIssues, replenishmentSuggestions] = await Promise.all([
      business.accountHealth.getListingIssues(tenantId),
      business.inventoryPlanning.getReplenishmentSuggestions(tenantId),
    ])

    const alerts = [
      ...listingIssues
        .filter((issue) => issue.resolvedAt == null)
        .map((issue) => ({
          id: issue.id,
          source: 'account_health' as const,
          platform: issue.platform,
          severity: issue.severity,
          title: issue.title,
          description: issue.description,
          affectedEntity: issue.productId || null,
          createdAt: issue.detectedAt,
        })),
      ...replenishmentSuggestions
        .filter((item) => item.urgency !== 'ok')
        .map((item) => ({
          id: `inventory:${item.platform}:${item.productId}`,
          source: 'inventory' as const,
          platform: item.platform,
          severity: item.urgency === 'critical' ? 'critical' : 'warning',
          title:
            item.urgency === 'critical'
              ? `Out of stock: ${item.sku}`
              : `Low stock: ${item.sku}`,
          description: `Current stock ${item.currentStock}, suggested replenish ${item.suggestedQty}`,
          affectedEntity: item.productId,
          createdAt: null,
        })),
    ]

    return reply.send({
      totalActive: alerts.length,
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

    const now = new Date()
    const overview = await request.withDb((db) => buildConsoleOverview(db, tenantId, now))

    return reply.send(overview)
  })
}

export default consoleRoute

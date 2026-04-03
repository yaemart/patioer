import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { and, count, desc, eq, gte, sql } from 'drizzle-orm'
import { schema, type AppDb } from '@patioer/db'
import {
  PLAN_AGENT_LIMITS,
  PLAN_BUDGET_USD,
  PLAN_NAMES,
  PLAN_PLATFORM_LIMITS,
} from '@patioer/shared'
import type { PlanName } from '@patioer/shared'

export interface DashboardSummary {
  tenantId: string
  plan: PlanName
  agents: {
    active: number
    total: number
    limit: number
    recentlyActive: boolean
    lastEventAt: string | null
  }
  platforms: {
    connected: number
    limit: number
  }
  billing: {
    usedUsd: number
    budgetUsd: number
    remainingUsd: number
    isOverBudget: boolean
  }
  approvals: {
    pending: number
  }
  onboarding: {
    currentStep: number
    completed: boolean
    healthCheckPassed: boolean
  }
}

type DashboardSummaryLoader = (request: FastifyRequest) => Promise<DashboardSummary>

let _summaryLoader: DashboardSummaryLoader | null = null

export function setDashboardDeps(
  deps: { summaryLoader?: DashboardSummaryLoader },
): void {
  _summaryLoader = deps.summaryLoader ?? null
}

function resolvePlan(raw: string | undefined): PlanName {
  if (raw && (PLAN_NAMES as readonly string[]).includes(raw)) {
    return raw as PlanName
  }
  return 'starter'
}

async function loadDashboardSummary(request: FastifyRequest): Promise<DashboardSummary> {
  if (!request.withDb || !request.tenantId) {
    throw new Error('Authentication required')
  }

  const tenantId = request.tenantId
  const plan = resolvePlan(request.auth?.plan)
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)

  return request.withDb(async (db) => {
    const [activeAgentsRow] = await db
      .select({ cnt: count() })
      .from(schema.agents)
      .where(and(eq(schema.agents.tenantId, tenantId), eq(schema.agents.status, 'active')))

    const [totalAgentsRow] = await db
      .select({ cnt: count() })
      .from(schema.agents)
      .where(eq(schema.agents.tenantId, tenantId))

    const [platformsRow] = await db
      .select({ cnt: count() })
      .from(schema.platformCredentials)
      .where(eq(schema.platformCredentials.tenantId, tenantId))

    const [usageRow] = await db
      .select({
        total: sql<string>`coalesce(sum(${schema.billingUsageLogs.costUsd}), 0)`,
      })
      .from(schema.billingUsageLogs)
      .where(
        and(
          eq(schema.billingUsageLogs.tenantId, tenantId),
          gte(schema.billingUsageLogs.createdAt, monthStart),
        ),
      )

    const [pendingApprovalsRow] = await db
      .select({ cnt: count() })
      .from(schema.approvals)
      .where(and(eq(schema.approvals.tenantId, tenantId), eq(schema.approvals.status, 'pending')))

    const [onboardingRow] = await db
      .select({
        currentStep: schema.onboardingProgress.currentStep,
        completedAt: schema.onboardingProgress.completedAt,
        healthCheckPassed: schema.onboardingProgress.healthCheckPassed,
      })
      .from(schema.onboardingProgress)
      .where(eq(schema.onboardingProgress.tenantId, tenantId))
      .limit(1)

    const [lastEventRow] = await db
      .select({ createdAt: schema.agentEvents.createdAt })
      .from(schema.agentEvents)
      .where(eq(schema.agentEvents.tenantId, tenantId))
      .orderBy(desc(schema.agentEvents.createdAt))
      .limit(1)

    const [recentEventsRow] = await db
      .select({ cnt: count() })
      .from(schema.agentEvents)
      .where(
        and(
          eq(schema.agentEvents.tenantId, tenantId),
          gte(schema.agentEvents.createdAt, recentCutoff),
        ),
      )

    const usedUsd = Number(usageRow?.total ?? 0)
    const budgetUsd = PLAN_BUDGET_USD[plan]

    return {
      tenantId,
      plan,
      agents: {
        active: activeAgentsRow?.cnt ?? 0,
        total: totalAgentsRow?.cnt ?? 0,
        limit: PLAN_AGENT_LIMITS[plan].length,
        recentlyActive: (recentEventsRow?.cnt ?? 0) > 0,
        lastEventAt: lastEventRow?.createdAt?.toISOString() ?? null,
      },
      platforms: {
        connected: platformsRow?.cnt ?? 0,
        limit: PLAN_PLATFORM_LIMITS[plan],
      },
      billing: {
        usedUsd,
        budgetUsd,
        remainingUsd: Math.max(budgetUsd - usedUsd, 0),
        isOverBudget: usedUsd > budgetUsd,
      },
      approvals: {
        pending: pendingApprovalsRow?.cnt ?? 0,
      },
      onboarding: {
        currentStep: onboardingRow?.currentStep ?? 1,
        completed: onboardingRow?.completedAt != null,
        healthCheckPassed: onboardingRow?.healthCheckPassed ?? false,
      },
    }
  })
}

export interface ProfitOverview {
  range: string
  grossRevenue: number
  netRevenue: number
  cogs: number
  platformFees: number
  shippingCosts: number
  adSpend: number
  refundAmount: number
  contributionMargin: number
  tacos: number | null
  unitsSold: number
}

function dateRangeStart(range: string): Date {
  const now = new Date()
  switch (range) {
    case '7d': return new Date(now.getTime() - 7 * 86400000)
    case '30d': return new Date(now.getTime() - 30 * 86400000)
    case '90d': return new Date(now.getTime() - 90 * 86400000)
    default: return new Date(now.getTime() - 7 * 86400000)
  }
}

function formatDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function loadProfitOverview(db: AppDb, tenantId: string, range: string): Promise<ProfitOverview> {
  const start = formatDateStr(dateRangeStart(range))

  const [row] = await db
    .select({
      grossRevenue: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.grossRevenue}), 0)`,
      netRevenue: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.netRevenue}), 0)`,
      cogs: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.cogs}), 0)`,
      platformFees: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.platformFee}), 0)`,
      shippingCosts: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.shippingCost}), 0)`,
      adSpend: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.adSpend}), 0)`,
      refundAmount: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.refundAmount}), 0)`,
      contributionMargin: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.contributionMargin}), 0)`,
      unitsSold: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.unitsSold}), 0)`,
    })
    .from(schema.unitEconomicsDaily)
    .where(and(
      eq(schema.unitEconomicsDaily.tenantId, tenantId),
      gte(schema.unitEconomicsDaily.date, start),
    ))

  const grossRevenue = Number(row?.grossRevenue ?? 0)
  const adSpend = Number(row?.adSpend ?? 0)

  return {
    range,
    grossRevenue,
    netRevenue: Number(row?.netRevenue ?? 0),
    cogs: Number(row?.cogs ?? 0),
    platformFees: Number(row?.platformFees ?? 0),
    shippingCosts: Number(row?.shippingCosts ?? 0),
    adSpend,
    refundAmount: Number(row?.refundAmount ?? 0),
    contributionMargin: Number(row?.contributionMargin ?? 0),
    tacos: grossRevenue > 0 ? adSpend / grossRevenue : null,
    unitsSold: Number(row?.unitsSold ?? 0),
  }
}

const dashboardRoute: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/dashboard/summary', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Get dashboard summary for the current tenant',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'Authentication required' })
    }

    const summaryLoader = _summaryLoader ?? loadDashboardSummary
    const summary = await summaryLoader(request)
    return reply.send(summary)
  })

  app.get<{ Querystring: { range?: string } }>('/api/v1/dashboard/overview', {
    schema: {
      tags: ['Dashboard'],
      summary: 'Profit cockpit overview with revenue, costs, and margins',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { range: { type: 'string', enum: ['7d', '30d', '90d'], default: '7d' } },
      },
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'Authentication required' })
    }
    const tenantId = request.tenantId
    const range = request.query.range ?? '7d'
    const overview = await request.withDb((db) => loadProfitOverview(db, tenantId, range))
    return reply.send(overview)
  })

  app.get<{ Querystring: { range?: string } }>('/api/v1/finance/unit-economics', {
    schema: {
      tags: ['Finance'],
      summary: 'Per-SKU unit economics breakdown',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { range: { type: 'string', enum: ['7d', '30d', '90d'], default: '7d' } },
      },
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'Authentication required' })
    }
    const tenantId = request.tenantId
    const range = request.query.range ?? '7d'
    const start = formatDateStr(dateRangeStart(range))

    const skus = await request.withDb(async (db) => {
      return db
        .select({
          platform: schema.unitEconomicsDaily.platform,
          productId: schema.unitEconomicsDaily.productId,
          grossRevenue: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.grossRevenue}), 0)`,
          netRevenue: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.netRevenue}), 0)`,
          cogs: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.cogs}), 0)`,
          platformFees: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.platformFee}), 0)`,
          adSpend: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.adSpend}), 0)`,
          refundAmount: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.refundAmount}), 0)`,
          contributionMargin: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.contributionMargin}), 0)`,
          unitsSold: sql<string>`coalesce(sum(${schema.unitEconomicsDaily.unitsSold}), 0)`,
        })
        .from(schema.unitEconomicsDaily)
        .where(and(
          eq(schema.unitEconomicsDaily.tenantId, tenantId),
          gte(schema.unitEconomicsDaily.date, start),
        ))
        .groupBy(schema.unitEconomicsDaily.platform, schema.unitEconomicsDaily.productId)
        .orderBy(sql`sum(${schema.unitEconomicsDaily.grossRevenue}) desc nulls last`)
        .limit(100)
    })

    return reply.send({
      range,
      skus: skus.map((r) => ({
        platform: r.platform,
        productId: r.productId,
        grossRevenue: Number(r.grossRevenue),
        netRevenue: Number(r.netRevenue),
        cogs: Number(r.cogs),
        platformFees: Number(r.platformFees),
        adSpend: Number(r.adSpend),
        refundAmount: Number(r.refundAmount),
        contributionMargin: Number(r.contributionMargin),
        unitsSold: Number(r.unitsSold),
      })),
    })
  })

  app.get('/api/v1/inventory/overview', {
    schema: {
      tags: ['Inventory'],
      summary: 'Inventory overview: low stock, out of stock, and inbound shipments',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'Authentication required' })
    }
    const tenantId = request.tenantId

    const result = await request.withDb(async (db) => {
      const lowStockItems = await db
        .select()
        .from(schema.inventoryLevels)
        .where(and(
          eq(schema.inventoryLevels.tenantId, tenantId),
          sql`${schema.inventoryLevels.status} IN ('low', 'out_of_stock')`,
        ))
        .orderBy(schema.inventoryLevels.quantity)
        .limit(50)

      const inboundShipments = await db
        .select()
        .from(schema.inventoryInboundShipments)
        .where(and(
          eq(schema.inventoryInboundShipments.tenantId, tenantId),
          eq(schema.inventoryInboundShipments.status, 'in_transit'),
        ))
        .limit(50)

      return {
        lowStock: lowStockItems.map((item) => ({
          productId: item.productId,
          platform: item.platform,
          quantity: item.quantity,
          safetyThreshold: item.safetyThreshold,
          status: item.status,
        })),
        inbound: inboundShipments.map((s) => ({
          productId: s.productId,
          platform: s.platform,
          quantity: s.quantity,
          status: s.status,
          expectedArrival: s.expectedArrival,
          supplier: s.supplier,
        })),
      }
    })

    return reply.send({
      lowStockCount: result.lowStock.length,
      inboundCount: result.inbound.length,
      ...result,
    })
  })

  app.get('/api/v1/dashboard/agent-outcomes', async (request, reply) => {
    if (!request.withDb || !request.tenantId) {
      return reply.code(401).send({ error: 'Authentication required' })
    }
    const tenantId = request.tenantId

    const result = await request.withDb(async (db) => {
      const events = await db
        .select()
        .from(schema.agentEvents)
        .where(
          and(
            eq(schema.agentEvents.tenantId, tenantId),
            sql`${schema.agentEvents.action} LIKE '%.pipeline.completed'`,
          ),
        )
        .orderBy(desc(schema.agentEvents.createdAt))
        .limit(100)

      let totalDecisions = 0
      let totalExecuted = 0
      let totalApprovals = 0
      let totalBlocked = 0
      let totalDegraded = 0
      let confidenceSum = 0

      for (const ev of events) {
        const p = ev.payload as Record<string, unknown> | null
        if (!p) continue
        totalDecisions += Number(p.total ?? 0)
        totalExecuted += Number(p.executed ?? 0)
        totalApprovals += Number(p.approvals ?? 0)
        totalBlocked += Number(p.blocked ?? 0)
        totalDegraded += Number(p.degraded ?? 0)
        confidenceSum += Number(p.confidence ?? 0)
      }

      return {
        pipelineRuns: events.length,
        totalDecisions,
        totalExecuted,
        totalApprovals,
        totalBlocked,
        totalDegraded,
        avgConfidence: events.length > 0 ? Math.round((confidenceSum / events.length) * 1000) / 1000 : 0,
        autoExecuteRate: totalDecisions > 0 ? Math.round((totalExecuted / totalDecisions) * 1000) / 1000 : 0,
        approvalRate: totalDecisions > 0 ? Math.round((totalApprovals / totalDecisions) * 1000) / 1000 : 0,
      }
    })

    return reply.send(result)
  })
}

export default dashboardRoute

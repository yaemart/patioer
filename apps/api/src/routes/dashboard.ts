import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { and, count, desc, eq, gte, sql } from 'drizzle-orm'
import { schema } from '@patioer/db'
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
}

export default dashboardRoute

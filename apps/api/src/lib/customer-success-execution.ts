import type { FastifyBaseLogger } from 'fastify'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- platform-level CS aggregation intentionally spans all tenants
import { db, schema } from '@patioer/db'
import { eq } from 'drizzle-orm'
import type { CsAgentDeps, TenantMetrics } from '@patioer/agent-runtime'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function isWithinLast30Days(value: Date | null | undefined): boolean {
  return value instanceof Date && value.getTime() >= Date.now() - THIRTY_DAYS_MS
}

function parseMoney(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function average(values: number[], fallback: number): number {
  if (values.length === 0) return fallback
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function calculateGmvTrendPct(currentTotal: number, previousTotal: number): number {
  if (previousTotal <= 0) {
    return currentTotal > 0 ? 100 : 0
  }
  return Math.round(((currentTotal - previousTotal) / previousTotal) * 100)
}

async function getTenantMetrics(tenantId: string): Promise<TenantMetrics> {
  const [onboarding] = await db
    .select({ healthCheckPassed: schema.onboardingProgress.healthCheckPassed })
    .from(schema.onboardingProgress)
    .where(eq(schema.onboardingProgress.tenantId, tenantId))
    .limit(1)

  const webhookRows = await db
    .select({
      status: schema.webhookEvents.status,
      receivedAt: schema.webhookEvents.receivedAt,
    })
    .from(schema.webhookEvents)
    .where(eq(schema.webhookEvents.tenantId, tenantId))

  const recentWebhookRows = webhookRows.filter((row) => isWithinLast30Days(row.receivedAt))
  const processedWebhooks = recentWebhookRows.filter((row) => row.status === 'processed').length
  const heartbeatSuccessRate = recentWebhookRows.length > 0
    ? processedWebhooks / recentWebhookRows.length
    : onboarding?.healthCheckPassed
      ? 1
      : 0.6

  const orderRows = await db
    .select({
      totalPrice: schema.orders.totalPrice,
      createdAt: schema.orders.createdAt,
    })
    .from(schema.orders)
    .where(eq(schema.orders.tenantId, tenantId))

  const recentOrders = orderRows.filter((row) => isWithinLast30Days(row.createdAt))
  const previousOrders = orderRows.filter((row) => {
    const createdAt = row.createdAt
    if (!(createdAt instanceof Date)) return false
    const now = Date.now()
    return createdAt.getTime() < now - THIRTY_DAYS_MS
      && createdAt.getTime() >= now - THIRTY_DAYS_MS * 2
  })

  const currentGmv = recentOrders.reduce((sum, row) => sum + parseMoney(row.totalPrice), 0)
  const previousGmv = previousOrders.reduce((sum, row) => sum + parseMoney(row.totalPrice), 0)

  const approvalRows = await db
    .select({
      createdAt: schema.approvals.createdAt,
      resolvedAt: schema.approvals.resolvedAt,
    })
    .from(schema.approvals)
    .where(eq(schema.approvals.tenantId, tenantId))

  const responseHours = approvalRows
    .filter((row) => row.createdAt instanceof Date && row.resolvedAt instanceof Date)
    .map((row) => (row.resolvedAt!.getTime() - row.createdAt!.getTime()) / (60 * 60 * 1000))

  return {
    tenantId,
    heartbeatSuccessRate,
    loginCountLast30d: recentOrders.length,
    avgApprovalResponseH: average(responseHours, 24),
    gmv30dTrendPct: calculateGmvTrendPct(currentGmv, previousGmv),
  }
}

export function createCustomerSuccessExecutionDeps(log: FastifyBaseLogger): CsAgentDeps {
  return {
    tenantStore: {
      async getActiveTenantIds() {
        const rows = await db
          .select({ id: schema.tenants.id })
          .from(schema.tenants)
        return rows.map((row) => row.id)
      },
    },
    metrics: {
      getTenantMetrics,
    },
    email: {
      async send(params) {
        log.info(
          { to: params.to, subject: params.subject },
          'customer_success.email.sent',
        )
      },
    },
  }
}

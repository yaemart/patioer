import type { AgentContext } from '../context.js'
import type {
  CustomerSuccessRunInput,
  CustomerSuccessResult,
  TenantHealthResult,
  TenantHealthDimension,
  TicketParams,
} from '../types.js'

const HEALTH_WEIGHTS = {
  heartbeat_rate: 0.3,
  login_frequency: 0.2,
  approval_response: 0.2,
  gmv_trend: 0.3,
} as const

const INTERVENTION_THRESHOLD = 40
const UPSELL_THRESHOLD = 80

export interface TenantMetrics {
  tenantId: string
  heartbeatSuccessRate: number
  loginCountLast30d: number
  avgApprovalResponseH: number
  gmv30dTrendPct: number
}

export interface TenantStore {
  getActiveTenantIds(): Promise<string[]>
}

export interface MetricsProvider {
  getTenantMetrics(tenantId: string): Promise<TenantMetrics>
}

export interface EmailSender {
  send(params: { to: string; subject: string; body: string }): Promise<void>
}

export interface CsAgentDeps {
  tenantStore: TenantStore
  metrics: MetricsProvider
  email: EmailSender
}

function scoreHeartbeatRate(rate: number): number {
  if (rate > 0.95) return 100
  if (rate >= 0.8) return 60
  return 20
}

function scoreLoginFrequency(logins: number): number {
  if (logins > 10) return 100
  if (logins >= 3) return 60
  return 20
}

function scoreApprovalResponse(avgHours: number): number {
  if (avgHours < 4) return 100
  if (avgHours <= 24) return 60
  return 20
}

function scoreGmvTrend(trendPct: number): number {
  if (trendPct > 5) return 100
  if (trendPct >= -5) return 60
  return 20
}

export function calcHealthScore(m: TenantMetrics): {
  score: number
  dimensions: TenantHealthDimension[]
} {
  const dimensions: TenantHealthDimension[] = [
    {
      dimension: 'heartbeat_rate',
      rawValue: m.heartbeatSuccessRate,
      score: scoreHeartbeatRate(m.heartbeatSuccessRate),
      weight: HEALTH_WEIGHTS.heartbeat_rate,
    },
    {
      dimension: 'login_frequency',
      rawValue: m.loginCountLast30d,
      score: scoreLoginFrequency(m.loginCountLast30d),
      weight: HEALTH_WEIGHTS.login_frequency,
    },
    {
      dimension: 'approval_response',
      rawValue: m.avgApprovalResponseH,
      score: scoreApprovalResponse(m.avgApprovalResponseH),
      weight: HEALTH_WEIGHTS.approval_response,
    },
    {
      dimension: 'gmv_trend',
      rawValue: m.gmv30dTrendPct,
      score: scoreGmvTrend(m.gmv30dTrendPct),
      weight: HEALTH_WEIGHTS.gmv_trend,
    },
  ]

  const score = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0),
  )

  return { score, dimensions }
}

export function createCustomerSuccessAgent(deps: CsAgentDeps) {
  async function handleIntervention(
    ctx: AgentContext,
    tenantId: string,
    score: number,
    dimensions: TenantHealthDimension[],
  ): Promise<void> {
    const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0]

    await deps.email.send({
      to: `tenant-${tenantId}@notifications`,
      subject: `[ElectroOS] Your store health needs attention (score: ${score})`,
      body: [
        `Your ElectroOS health score has dropped to ${score}/100.`,
        `Weakest area: ${weakest.dimension} (${weakest.score}/100).`,
        'Our team is reviewing your account and will reach out with recommendations.',
      ].join('\n'),
    })

    const ticketParams: TicketParams = {
      title: `[CS] Tenant ${tenantId} health score ${score} — intervention needed`,
      body: `Health score: ${score}/100\nWeakest: ${weakest.dimension} (${weakest.score})\nDimensions: ${JSON.stringify(dimensions)}`,
    }
    await ctx.createTicket(ticketParams)
    await ctx.logAction('cs.intervention', { tenantId, score, weakest: weakest.dimension })
  }

  async function handleHighSatisfaction(
    ctx: AgentContext,
    tenantId: string,
    score: number,
  ): Promise<void> {
    await deps.email.send({
      to: `tenant-${tenantId}@notifications`,
      subject: `[ElectroOS] Your store is performing great! (score: ${score})`,
      body: [
        `Congratulations! Your ElectroOS health score is ${score}/100.`,
        'Consider upgrading your plan to unlock more agents and higher budgets.',
        'We would also love your feedback — please leave a review on ClipMart!',
      ].join('\n'),
    })

    await ctx.logAction('cs.upsell_suggestion', { tenantId, score })
  }

  async function run(
    ctx: AgentContext,
    input: CustomerSuccessRunInput,
  ): Promise<CustomerSuccessResult> {
    const budgetExceeded = await ctx.budget.isExceeded()
    if (budgetExceeded) {
      await ctx.logAction('cs.budget_exceeded', { skipped: true })
      return {
        runId: ctx.agentId,
        tenantsScanned: 0,
        results: [],
        interventionsSent: 0,
        upsellsSuggested: 0,
      }
    }

    const tenantIds = input.tenantIds ?? await deps.tenantStore.getActiveTenantIds()
    const results: TenantHealthResult[] = []
    let interventionsSent = 0
    let upsellsSuggested = 0

    for (const tenantId of tenantIds) {
      const metrics = await deps.metrics.getTenantMetrics(tenantId)
      const { score, dimensions } = calcHealthScore(metrics)

      let action: TenantHealthResult['action'] = 'none'

      if (score < INTERVENTION_THRESHOLD) {
        await handleIntervention(ctx, tenantId, score, dimensions)
        action = 'intervention'
        interventionsSent++
      } else if (score > UPSELL_THRESHOLD) {
        await handleHighSatisfaction(ctx, tenantId, score)
        action = 'upsell_suggestion'
        upsellsSuggested++
      }

      results.push({ tenantId, score, dimensions, action })
    }

    await ctx.logAction('cs.cycle_complete', {
      tenantsScanned: tenantIds.length,
      interventionsSent,
      upsellsSuggested,
    })

    return {
      runId: ctx.agentId,
      tenantsScanned: tenantIds.length,
      results,
      interventionsSent,
      upsellsSuggested,
    }
  }

  return { run, calcHealthScore }
}

export type CustomerSuccessAgent = ReturnType<typeof createCustomerSuccessAgent>

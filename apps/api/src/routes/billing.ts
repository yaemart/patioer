import type { FastifyPluginAsync } from 'fastify'
import { and, eq, gte, sql } from 'drizzle-orm'
import { schema } from '@patioer/db'
import { billingOperationTotal } from '../plugins/metrics.js'
import { PLAN_BUDGET_USD, PLAN_NAMES, TRIAL_PERIOD_DAYS } from '@patioer/shared'
import type { PlanName } from '@patioer/shared'
import {
  createStripeBillingClient,
  StripeBillingClientError,
} from '@patioer/billing'

interface CheckoutSessionBody {
  plan: 'starter' | 'growth' | 'scale'
  successUrl?: string
  cancelUrl?: string
}

function resolvePlan(auth: { plan: string } | null | undefined): PlanName {
  if (auth && (PLAN_NAMES as readonly string[]).includes(auth.plan)) return auth.plan as PlanName
  return 'starter'
}

function getStripeClient() {
  return createStripeBillingClient({
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  })
}

const billingRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Body: CheckoutSessionBody }>('/api/v1/billing/checkout-session', {
    schema: {
      tags: ['Billing'],
      summary: 'Create a Stripe Checkout Session',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['plan'],
        properties: {
          plan: { type: 'string', enum: ['starter', 'growth', 'scale'] },
          successUrl: { type: 'string' },
          cancelUrl: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: { url: { type: 'string' }, sessionId: { type: 'string' } },
        },
        400: {
          type: 'object',
          properties: { message: { type: 'string' } },
        },
        503: {
          type: 'object',
          properties: { message: { type: 'string' } },
        },
        502: {
          type: 'object',
          properties: { message: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const { plan, successUrl, cancelUrl } = request.body
    const tenantId = request.tenantId
    if (!tenantId) {
      return reply.status(400).send({ message: 'Tenant context required' })
    }

    const priceEnvKey = `STRIPE_PRICE_${plan.toUpperCase()}_MONTHLY`
    const priceId = process.env[priceEnvKey]
    if (!priceId) {
      return reply.status(503).send({ message: `Price not configured for plan: ${plan}` })
    }

    try {
      const session = await getStripeClient().createCheckoutSession({
        priceId,
        successUrl:
          successUrl
          ?? `${process.env.WEB_URL ?? 'http://localhost:3000'}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: cancelUrl ?? `${process.env.WEB_URL ?? 'http://localhost:3000'}/pricing`,
        trialPeriodDays: TRIAL_PERIOD_DAYS,
        metadata: { tenantId, plan },
      })

      billingOperationTotal.labels('checkout_session', plan).inc()
      return { url: session.url, sessionId: session.id }
    } catch (error) {
      if (error instanceof StripeBillingClientError && error.code === 'not_configured') {
        return reply.status(503).send({ message: 'Stripe not configured' })
      }

      request.log.error({ err: error, tenantId, plan }, 'failed to create Stripe checkout session')
      return reply.status(502).send({ message: 'Failed to create checkout session' })
    }
  })

  app.get('/api/v1/billing/portal-session', {
    schema: {
      tags: ['Billing'],
      summary: 'Create a Stripe Customer Portal Session',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: { url: { type: 'string' } },
        },
        400: {
          type: 'object',
          properties: { message: { type: 'string' } },
        },
        503: {
          type: 'object',
          properties: { message: { type: 'string' } },
        },
        502: {
          type: 'object',
          properties: { message: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const tenantId = request.tenantId
    if (!tenantId || !request.withDb) {
      return reply.status(400).send({ message: 'Tenant context required' })
    }

    const [tenant] = await request.withDb((tdb) =>
      tdb
        .select({ stripeCustomerId: schema.tenants.stripeCustomerId })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId))
        .limit(1),
    )

    const stripeCustomerId = tenant?.stripeCustomerId ?? ''
    if (!stripeCustomerId) {
      return reply.status(400).send({ message: 'No Stripe customer linked to this tenant' })
    }

    try {
      const session = await getStripeClient().createPortalSession({
        customerId: stripeCustomerId,
        returnUrl: `${process.env.WEB_URL ?? 'http://localhost:3000'}/dashboard`,
      })

      billingOperationTotal.labels('portal_session', 'n/a').inc()
      return { url: session.url }
    } catch (error) {
      if (error instanceof StripeBillingClientError && error.code === 'not_configured') {
        return reply.status(503).send({ message: 'Stripe not configured' })
      }

      request.log.error({ err: error, tenantId }, 'failed to create Stripe portal session')
      return reply.status(502).send({ message: 'Failed to create portal session' })
    }
  })

  app.get('/api/v1/billing/usage', {
    schema: {
      tags: ['Billing'],
      summary: 'Get current month usage summary',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            tenantId: { type: 'string' },
            plan: { type: 'string' },
            budgetUsd: { type: 'number' },
            usedUsd: { type: 'number' },
            remainingUsd: { type: 'number' },
            isOverBudget: { type: 'boolean' },
          },
        },
        400: {
          type: 'object',
          properties: { message: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const tenantId = request.tenantId
    if (!tenantId || !request.withDb) {
      return reply.status(400).send({ message: 'Tenant context required' })
    }

    const plan = resolvePlan(request.auth)
    const budget = PLAN_BUDGET_USD[plan]

    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)

    const usedUsd = await request.withDb(async (tdb) => {
      const [row] = await tdb
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
      return Number(row?.total ?? 0)
    })

    return {
      tenantId,
      plan,
      budgetUsd: budget,
      usedUsd,
      remainingUsd: Math.max(budget - usedUsd, 0),
      isOverBudget: usedUsd > budget,
    }
  })
}

export default billingRoute

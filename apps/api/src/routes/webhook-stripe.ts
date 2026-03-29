import type { FastifyPluginAsync } from 'fastify'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { stripeWebhookTotal } from '../plugins/metrics.js'
import { createWebhookHandler } from '@patioer/billing'
import type { WebhookHandlerDeps, WebhookEvent } from '@patioer/billing'

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? ''

function verifyStripeSignature(payload: string, sigHeader: string, secret: string): boolean {
  if (!secret || !sigHeader) return false

  const elements = sigHeader.split(',')
  const timestampStr = elements.find((e) => e.startsWith('t='))?.slice(2)
  const signatureStr = elements.find((e) => e.startsWith('v1='))?.slice(3)

  if (!timestampStr || !signatureStr) return false

  const expectedSig = createHmac('sha256', secret)
    .update(`${timestampStr}.${payload}`)
    .digest('hex')

  const expected = Buffer.from(expectedSig, 'hex')
  const actual = Buffer.from(signatureStr, 'hex')

  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

const noopWebhookDeps: WebhookHandlerDeps = {
  tenantStore: {
    findTenantByStripeCustomerId: async () => null,
    updateTenant: async () => {},
  },
  agentManager: {
    suspendAllAgents: async () => 0,
    suspendAgents: async () => 0,
    getActiveAgentIds: async () => [],
  },
  usageStore: { resetMonthlyUsage: async () => {} },
  gracePeriod: {
    scheduleAgentSuspension: async () => 'noop',
    cancelScheduled: async () => {},
  },
  dataRetention: { scheduleDataDeletion: async () => {} },
}

let _webhookDeps: WebhookHandlerDeps = noopWebhookDeps

export function setWebhookDeps(deps: WebhookHandlerDeps): void {
  _webhookDeps = deps
}

const KNOWN_EVENT_TYPES = new Set<string>([
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'customer.subscription.deleted',
  'customer.subscription.updated',
])

const webhookStripeRoute: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body)
  })

  app.post('/api/v1/webhooks/stripe', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Stripe webhook receiver',
      response: {
        200: { type: 'object', properties: { received: { type: 'boolean' } } },
        400: { type: 'object', properties: { message: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const rawBody = request.body as string
    const sigHeader = request.headers['stripe-signature'] as string

    if (STRIPE_WEBHOOK_SECRET && !verifyStripeSignature(rawBody, sigHeader ?? '', STRIPE_WEBHOOK_SECRET)) {
      stripeWebhookTotal.labels('invalid_signature', 'rejected').inc()
      return reply.status(400).send({ message: 'Invalid signature' })
    }

    let event: { type: string; data: { object: Record<string, unknown> } }
    try {
      event = JSON.parse(rawBody)
    } catch {
      return reply.status(400).send({ message: 'Invalid JSON' })
    }

    app.log.info({ eventType: event.type }, 'Stripe webhook received')

    if (KNOWN_EVENT_TYPES.has(event.type)) {
      const handler = createWebhookHandler(_webhookDeps)
      const result = await handler.handleEvent(event as WebhookEvent)
      const status = result.handled ? 'processed' : 'skipped'
      stripeWebhookTotal.labels(event.type, status).inc()
      app.log.info({ eventType: event.type, action: result.action, tenantId: result.tenantId }, 'Webhook handled')
    } else {
      stripeWebhookTotal.labels(event.type, 'ignored').inc()
    }

    return { received: true }
  })
}

export default webhookStripeRoute

export { verifyStripeSignature as _testVerifyStripeSignature }

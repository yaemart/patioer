import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import webhookStripeRoute from './webhook-stripe.js'

function createApp() {
  const app = Fastify()
  app.register(webhookStripeRoute)
  return app
}

describe('webhook-stripe route', () => {
  it('accepts valid webhook event', async () => {
    const app = createApp()
    const event = { type: 'invoice.payment_succeeded', data: { object: { customer: 'cus_123' } } }

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      payload: JSON.stringify(event),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true })
    await app.close()
  })

  it('rejects invalid JSON', async () => {
    const app = createApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      payload: 'not json',
      headers: { 'content-type': 'application/json' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('handles all 4 event types', async () => {
    const app = createApp()
    const eventTypes = [
      'invoice.payment_succeeded',
      'invoice.payment_failed',
      'customer.subscription.deleted',
      'customer.subscription.updated',
    ]

    for (const type of eventTypes) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        payload: JSON.stringify({ type, data: { object: { customer: 'cus_123' } } }),
        headers: { 'content-type': 'application/json' },
      })
      expect(res.statusCode).toBe(200)
    }
    await app.close()
  })
})

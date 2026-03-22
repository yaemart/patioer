import { createHmac } from 'node:crypto'
import { describe, it, expect, beforeEach } from 'vitest'
import Fastify from 'fastify'
import shopeeWebhookRoute, { verifyShopeeWebhookSignature } from './webhook.js'

const PARTNER_KEY = 'webhook-partner-key'
const PARTNER_ID = 100001

beforeEach(() => {
  process.env.SHOPEE_PARTNER_KEY = PARTNER_KEY
  process.env.SHOPEE_PARTNER_ID = String(PARTNER_ID)
})

function buildApp() {
  const app = Fastify({ logger: false })
  app.register(shopeeWebhookRoute)
  return app
}

function signBody(url: string, body: string): string {
  const base = `${PARTNER_ID}${url}${body}`
  return createHmac('sha256', PARTNER_KEY).update(base).digest('hex')
}

describe('verifyShopeeWebhookSignature', () => {
  it('produces deterministic hex digest', () => {
    const buf = Buffer.from('{"code":1}')
    const a = verifyShopeeWebhookSignature(PARTNER_KEY, PARTNER_ID, '/api/v1/webhooks/shopee', buf)
    const b = verifyShopeeWebhookSignature(PARTNER_KEY, PARTNER_ID, '/api/v1/webhooks/shopee', buf)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('POST /api/v1/webhooks/shopee', () => {
  it('POST /webhooks/shopee returns 401 when signature is invalid', async () => {
    const app = buildApp()
    const body = JSON.stringify({ code: 3, shop_id: 1 })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/shopee',
      headers: {
        'content-type': 'application/json',
        authorization: 'deadbeef',
      },
      payload: body,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json<{ error: string }>().error).toContain('signature')
  })

  it('POST /webhooks/shopee returns 200 for order event with valid signature', async () => {
    const app = buildApp()
    const body = JSON.stringify({ code: 3, data: {}, shop_id: 777 })
    const sig = signBody('/api/v1/webhooks/shopee', body)
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/shopee',
      headers: {
        'content-type': 'application/json',
        authorization: sig,
      },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })
})

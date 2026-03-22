import { createHmac } from 'node:crypto'
import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetTenantIdByShopDomain,
  mockWithTenantDb,
  mockRecordWebhookIfNew,
  mockMarkWebhookProcessed,
  mockMarkWebhookFailed,
} = vi.hoisted(() => ({
  mockGetTenantIdByShopDomain: vi.fn(),
  mockWithTenantDb: vi.fn(),
  mockRecordWebhookIfNew: vi.fn(),
  mockMarkWebhookProcessed: vi.fn(),
  mockMarkWebhookFailed: vi.fn(),
}))

vi.mock('@patioer/db', () => ({
  getTenantIdByShopDomain: mockGetTenantIdByShopDomain,
  withTenantDb: mockWithTenantDb,
  schema: {
    orders: {
      tenantId: 'tenantId',
      platform: 'platform',
      platformOrderId: 'platformOrderId',
    },
  },
}))

vi.mock('../../lib/webhook-dedup.js', () => ({
  recordWebhookIfNew: mockRecordWebhookIfNew,
  markWebhookProcessed: mockMarkWebhookProcessed,
  markWebhookFailed: mockMarkWebhookFailed,
}))

import shopifyWebhookRoute from './webhook.js'

const WEBHOOK_SECRET = 'test-webhook-secret'
const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'
const SHOP_DOMAIN = 'test.myshopify.com'
const WEBHOOK_ID = 'wh-abc-123'

function buildHmac(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64')
}

function createApp(): ReturnType<typeof Fastify> {
  const app = Fastify({ logger: false })
  app.register(shopifyWebhookRoute)
  return app
}

function baseHeaders(body: string, overrides?: Record<string, string>) {
  return {
    'content-type': 'application/json',
    'x-shopify-hmac-sha256': buildHmac(body, WEBHOOK_SECRET),
    'x-shopify-topic': 'orders/create',
    'x-shopify-shop-domain': SHOP_DOMAIN,
    'x-shopify-webhook-id': WEBHOOK_ID,
    ...overrides,
  }
}

const ORDER_PAYLOAD = JSON.stringify({ id: 42, financial_status: 'paid', total_price: '99.00' })

function makeDb() {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SHOPIFY_WEBHOOK_SECRET = WEBHOOK_SECRET
  mockGetTenantIdByShopDomain.mockResolvedValue(TENANT_ID)
  mockWithTenantDb.mockImplementation(
    async (_tid: string, cb: (db: unknown) => Promise<unknown>) => await cb(makeDb()),
  )
  mockRecordWebhookIfNew.mockResolvedValue({ duplicate: false, eventId: 'evt-1' })
  mockMarkWebhookProcessed.mockResolvedValue(undefined)
  mockMarkWebhookFailed.mockResolvedValue(undefined)
})

describe('POST /api/v1/webhooks/shopify', () => {
  it('returns 503 when SHOPIFY_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.SHOPIFY_WEBHOOK_SECRET
    const app = createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/shopify',
      headers: { 'content-type': 'application/json' },
      body: ORDER_PAYLOAD,
    })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'webhook not configured' })
    await app.close()
  })

  it('returns 401 when x-shopify-hmac-sha256 header is missing', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/shopify',
      headers: {
        'content-type': 'application/json',
        'x-shopify-shop-domain': SHOP_DOMAIN,
      },
      body: ORDER_PAYLOAD,
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'missing HMAC header' })
    await app.close()
  })

  it('returns 401 when HMAC signature does not match', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/shopify',
      headers: baseHeaders(ORDER_PAYLOAD, { 'x-shopify-hmac-sha256': 'aW52YWxpZA==' }),
      body: ORDER_PAYLOAD,
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'invalid HMAC' })
    await app.close()
  })

  it('returns 400 when shop domain header is missing', async () => {
    const app = createApp()
    const headers = baseHeaders(ORDER_PAYLOAD)
    delete (headers as Record<string, string>)['x-shopify-shop-domain']
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/shopify',
      headers,
      body: ORDER_PAYLOAD,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'missing shop domain header' })
    await app.close()
  })

  it('returns 400 when body is not valid JSON', async () => {
    const badBody = 'not-json'
    const app = createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/shopify',
      headers: baseHeaders(badBody),
      body: badBody,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid JSON payload' })
    await app.close()
  })

  it('returns 200 ok:true for valid orders/create webhook', async () => {
    const app = createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/shopify',
      headers: baseHeaders(ORDER_PAYLOAD),
      body: ORDER_PAYLOAD,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: true })
    expect(mockMarkWebhookProcessed).toHaveBeenCalledOnce()
    await app.close()
  })

  it('returns 200 with duplicate:true when same webhookId is replayed', async () => {
    mockRecordWebhookIfNew.mockResolvedValueOnce({ duplicate: true })
    const app = createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/shopify',
      headers: baseHeaders(ORDER_PAYLOAD),
      body: ORDER_PAYLOAD,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, duplicate: true })
    expect(mockMarkWebhookProcessed).not.toHaveBeenCalled()
    await app.close()
  })

  it('returns 200 for unrecognised topic without calling dispatch handler', async () => {
    const body = JSON.stringify({ id: 1 })
    const app = createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/shopify',
      headers: baseHeaders(body, { 'x-shopify-topic': 'products/update' }),
      body,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: true })
    await app.close()
  })

  it('uses fallback webhookId when x-shopify-webhook-id header is absent', async () => {
    const app = createApp()
    const headers = baseHeaders(ORDER_PAYLOAD)
    delete (headers as Record<string, string>)['x-shopify-webhook-id']
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/shopify',
      headers,
      body: ORDER_PAYLOAD,
    })
    expect(response.statusCode).toBe(200)
    // recordWebhookIfNew called with a generated fallback id
    expect(mockRecordWebhookIfNew).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ webhookId: expect.stringContaining(SHOP_DOMAIN) }),
      expect.anything(),
    )
    await app.close()
  })

  it('marks event as failed when dispatch handler throws', async () => {
    // First call: dedup recordWebhookIfNew → returns eventId
    // Second call: handleOrdersCreate inside dispatchWebhook → throw
    // Third call: markWebhookFailed → succeed
    let callCount = 0
    mockWithTenantDb.mockImplementation(
      async (_tid: string, cb: (db: unknown) => Promise<unknown>) => {
        callCount += 1
        if (callCount === 2) throw new Error('dispatch failed')
        return await cb(makeDb())
      },
    )
    mockRecordWebhookIfNew.mockResolvedValueOnce({ duplicate: false, eventId: 'evt-fail' })

    const app = createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/shopify',
      headers: baseHeaders(ORDER_PAYLOAD),
      body: ORDER_PAYLOAD,
    })
    expect(response.statusCode).toBe(200)
    expect(mockMarkWebhookFailed).toHaveBeenCalledWith(
      expect.anything(),
      'evt-fail',
      'dispatch failed',
    )
    await app.close()
  })

  it('does not mark event as failed when dispatch succeeds but markWebhookProcessed fails', async () => {
    mockRecordWebhookIfNew.mockResolvedValueOnce({ duplicate: false, eventId: 'evt-processed-fail' })
    mockMarkWebhookProcessed.mockRejectedValueOnce(new Error('status write failed'))

    const app = createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/shopify',
      headers: baseHeaders(ORDER_PAYLOAD),
      body: ORDER_PAYLOAD,
    })
    expect(response.statusCode).toBe(200)
    expect(mockMarkWebhookProcessed).toHaveBeenCalledOnce()
    expect(mockMarkWebhookFailed).not.toHaveBeenCalled()
    await app.close()
  })

  it('falls through to unhandled branch when tenantId is not found', async () => {
    mockGetTenantIdByShopDomain.mockResolvedValueOnce(null)
    const app = createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/shopify',
      headers: baseHeaders(ORDER_PAYLOAD),
      body: ORDER_PAYLOAD,
    })
    expect(response.statusCode).toBe(200)
    expect(mockRecordWebhookIfNew).not.toHaveBeenCalled()
    await app.close()
  })

  it('returns 200 gracefully when dedup DB call throws (safety net)', async () => {
    // Simulates an unexpected DB error during the recordWebhookIfNew withTenantDb call.
    // The endpoint must not surface a 500 to Shopify (Shopify would retry indefinitely).
    mockWithTenantDb.mockRejectedValueOnce(new Error('DB connection lost'))
    const app = createApp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/shopify',
      headers: baseHeaders(ORDER_PAYLOAD),
      body: ORDER_PAYLOAD,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(mockMarkWebhookProcessed).not.toHaveBeenCalled()
    await app.close()
  })
})

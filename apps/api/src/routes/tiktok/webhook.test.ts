import { createHmac } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import tikTokWebhookRoute, {
  TIKTOK_WEBHOOK_TOPIC_LIVE_ORDER,
  verifyTikTokWebhookSignature,
} from './webhook.js'

// --- Mocks ---
vi.mock('@patioer/db', () => ({
  withTenantDb: vi.fn(),
  schema: {
    webhookEvents: {
      tenantId: 'tenantId',
      platform: 'platform',
      webhookId: 'webhookId',
    },
  },
}))

const { withTenantDb } = await import('@patioer/db')

const APP_SECRET = 'test-tiktok-app-secret'
const TENANT_ID = 'tenant-xyz'

const ENV = { TIKTOK_APP_SECRET: APP_SECRET }

function buildApp() {
  const app = Fastify({ logger: false })
  app.register(tikTokWebhookRoute)
  return app
}

/**
 * Builds a valid HMAC-SHA256 Base64 signature matching verifyTikTokWebhookSignature.
 */
function buildSignature(secret: string, timestamp: string, nonce: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}${nonce}${body}`).digest('base64')
}

function makeHeaders(
  signature: string,
  timestamp = '1700000000',
  nonce = 'test-nonce',
): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-tenant-id': TENANT_ID,
    authorization: signature,
    'x-timestamp': timestamp,
    'x-nonce': nonce,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(process.env, ENV)
})

// ── verifyTikTokWebhookSignature (unit) ───────────────────────────────────────

describe('verifyTikTokWebhookSignature', () => {
  it('returns true for a valid signature', () => {
    const body = '{"type":"ORDER_STATUS_CHANGE"}'
    const ts = '1700000000'
    const nonce = 'abc'
    const sig = buildSignature(APP_SECRET, ts, nonce, body)
    expect(verifyTikTokWebhookSignature(APP_SECRET, sig, ts, nonce, body)).toBe(true)
  })

  it('returns false when signature is tampered', () => {
    const body = '{"type":"ORDER_STATUS_CHANGE"}'
    expect(verifyTikTokWebhookSignature(APP_SECRET, 'wrongsig==', '0', 'nonce', body)).toBe(false)
  })

  it('returns false when body is different', () => {
    const ts = '1700000000'
    const nonce = 'nonce'
    const sig = buildSignature(APP_SECRET, ts, nonce, '{"type":"A"}')
    expect(verifyTikTokWebhookSignature(APP_SECRET, sig, ts, nonce, '{"type":"B"}')).toBe(false)
  })

  it('accepts a Buffer body equivalent to the string body', () => {
    const body = '{"type":"PRODUCT_UPDATE"}'
    const ts = '999'
    const nonce = 'n1'
    const sig = buildSignature(APP_SECRET, ts, nonce, body)
    expect(verifyTikTokWebhookSignature(APP_SECRET, sig, ts, nonce, Buffer.from(body))).toBe(true)
  })
})

// ── POST /api/v1/webhooks/tiktok ──────────────────────────────────────────────

describe('POST /api/v1/webhooks/tiktok', () => {
  it('returns 503 when TIKTOK_APP_SECRET is not configured', async () => {
    delete process.env.TIKTOK_APP_SECRET
    const app = buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/v1/webhooks/tiktok' })
    expect(res.statusCode).toBe(503)
  })

  it('returns 400 when x-tenant-id header is missing', async () => {
    const body = '{}'
    const sig = buildSignature(APP_SECRET, '0', 'n', body)
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/tiktok',
      headers: {
        'content-type': 'application/json',
        authorization: sig,
        'x-timestamp': '0',
        'x-nonce': 'n',
      },
      payload: body,
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ error: string }>().error).toContain('x-tenant-id')
  })

  it('returns 401 when signature is invalid', async () => {
    const body = JSON.stringify({ type: 'ORDER_STATUS_CHANGE', message_id: 'msg-1' })
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/tiktok',
      headers: makeHeaders('bad-signature=='),
      payload: body,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json<{ error: string }>().error).toContain('signature')
  })

  it('returns 400 for invalid JSON body (even after signature passes)', async () => {
    // We bypass signature check by using a valid signature for the invalid body
    const rawBody = 'not-json'
    const ts = '1700000000'
    const nonce = 'n'
    const sig = buildSignature(APP_SECRET, ts, nonce, rawBody)
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/tiktok',
      headers: { ...makeHeaders(sig, ts, nonce), 'content-type': 'application/json' },
      payload: rawBody,
    })
    expect(res.statusCode).toBe(400)
  })

  it('persists LIVE_ORDER with status received_live (live-commerce priority)', async () => {
    let capturedValues: Record<string, unknown> | null = null
    vi.mocked(withTenantDb).mockImplementationOnce(async (_tid, fn) => {
      await fn({
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            capturedValues = v
            return { onConflictDoNothing: vi.fn().mockResolvedValueOnce(undefined) }
          },
        }),
      } as never)
    })

    const body = JSON.stringify({
      type: TIKTOK_WEBHOOK_TOPIC_LIVE_ORDER,
      message_id: 'live-msg-1',
      data: { order_id: 'ord-live-1' },
    })
    const ts = '1700000002'
    const nonce = 'nlive'
    const sig = buildSignature(APP_SECRET, ts, nonce, body)

    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/tiktok',
      headers: makeHeaders(sig, ts, nonce),
      payload: body,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(capturedValues).not.toBeNull()
    const captured = capturedValues as unknown as Record<string, unknown>
    expect(captured['status']).toBe('received_live')
    expect(captured['topic']).toBe('LIVE_ORDER')
    expect((captured['payload'] as Record<string, unknown>)['type']).toBe('LIVE_ORDER')
  })

  it('persists webhook event and returns { ok: true }', async () => {
    vi.mocked(withTenantDb).mockImplementationOnce(async (_tid, fn) => {
      await fn({
        insert: () => ({
          values: () => ({
            onConflictDoNothing: vi.fn().mockResolvedValueOnce(undefined),
          }),
        }),
      } as never)
    })

    const body = JSON.stringify({ type: 'ORDER_STATUS_CHANGE', message_id: 'msg-42' })
    const ts = '1700000000'
    const nonce = 'n123'
    const sig = buildSignature(APP_SECRET, ts, nonce, body)

    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/tiktok',
      headers: makeHeaders(sig, ts, nonce),
      payload: body,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(withTenantDb).toHaveBeenCalledWith(TENANT_ID, expect.any(Function))
  })

  it('returns 500 when DB insert throws', async () => {
    vi.mocked(withTenantDb).mockRejectedValueOnce(new Error('db error'))

    const body = JSON.stringify({ type: 'PRODUCT_UPDATE', message_id: 'msg-99' })
    const ts = '1700000000'
    const nonce = 'n99'
    const sig = buildSignature(APP_SECRET, ts, nonce, body)

    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/tiktok',
      headers: makeHeaders(sig, ts, nonce),
      payload: body,
    })

    expect(res.statusCode).toBe(500)
  })

  it('uses a generated UUID when message_id is absent', async () => {
    let capturedValues: Record<string, unknown> | null = null
    vi.mocked(withTenantDb).mockImplementationOnce(async (_tid, fn) => {
      await fn({
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            capturedValues = v
            return { onConflictDoNothing: vi.fn().mockResolvedValueOnce(undefined) }
          },
        }),
      } as never)
    })

    const body = JSON.stringify({ type: 'SOME_EVENT' })
    const ts = '1700000001'
    const nonce = 'n0'
    const sig = buildSignature(APP_SECRET, ts, nonce, body)

    const app = buildApp()
    await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/tiktok',
      headers: makeHeaders(sig, ts, nonce),
      payload: body,
    })

    const captured = capturedValues as unknown as Record<string, unknown>
    expect(typeof captured['webhookId']).toBe('string')
    expect((captured['webhookId'] as string).length).toBeGreaterThan(0)
  })
})

import { createHash, createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import walmartWebhookRoute, { verifyWalmartWebhookSignature } from './webhook.js'

const {
  capturedRows,
  mockHandleWalmartWebhook,
  mockWithTenantDb,
  schemaMock,
} = vi.hoisted(() => {
  const rows: Array<Record<string, unknown>> = []
  return {
    capturedRows: rows,
    mockHandleWalmartWebhook: vi.fn(async () => {}),
    mockWithTenantDb: vi.fn(async (_tenantId: string, cb: (db: unknown) => Promise<unknown>) => {
      const db = {
        insert: vi.fn(() => ({
          values: vi.fn((row: Record<string, unknown>) => {
            rows.push(row)
            return {
              onConflictDoNothing: vi.fn(async () => {}),
            }
          }),
        })),
      }
      return cb(db)
    }),
    schemaMock: {
      webhookEvents: 'webhookEvents',
    },
  }
})

vi.mock('@patioer/db', () => ({
  withTenantDb: mockWithTenantDb,
  schema: schemaMock,
}))

vi.mock('../../lib/webhook-topic-handler.js', () => ({
  handleWalmartWebhook: mockHandleWalmartWebhook,
}))

const WEBHOOK_SECRET = 'walmart-webhook-secret'
const TENANT_ID = '11111111-1111-1111-1111-111111111111'

function buildApp() {
  const app = Fastify({ logger: false })
  app.register(walmartWebhookRoute)
  return app
}

function sha256Hex(body: string): string {
  return createHash('sha256').update(body).digest('hex')
}

function sign(pathAndQuery: string, body: string, timestamp: string): string {
  const toSign = ['POST', pathAndQuery, timestamp, sha256Hex(body)].join('\n')
  return createHmac('sha256', WEBHOOK_SECRET).update(toSign, 'utf8').digest('base64')
}

beforeEach(() => {
  process.env.WALMART_WEBHOOK_SECRET = WEBHOOK_SECRET
  vi.clearAllMocks()
  capturedRows.length = 0
})

describe('verifyWalmartWebhookSignature', () => {
  it('accepts a valid Walmart signature', () => {
    const body = Buffer.from('{"source":{"eventId":"evt-1"}}')
    const timestamp = String(Math.floor(Date.now() / 1000))
    const providedSignature = sign('/api/v1/webhooks/walmart?tenantId=tenant', body.toString('utf8'), timestamp)

    expect(verifyWalmartWebhookSignature({
      method: 'POST',
      pathAndQuery: '/api/v1/webhooks/walmart?tenantId=tenant',
      timestamp,
      rawBody: body,
      providedSignature,
      secret: WEBHOOK_SECRET,
    })).toBe(true)
  })
})

describe('POST /api/v1/webhooks/walmart', () => {
  it('accepts a signed webhook without JWT and resolves tenant from signed query', async () => {
    const app = buildApp()
    const body = JSON.stringify({
      source: { eventId: 'evt-1', eventType: 'SELLER_PERFORMANCE_NOTIFICATIONS' },
      payload: { notificationType: 'REPORT', partnerId: 'partner-1' },
    })
    const pathAndQuery = `/api/v1/webhooks/walmart?tenantId=${TENANT_ID}`
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = sign(pathAndQuery, body, timestamp)

    const res = await app.inject({
      method: 'POST',
      url: pathAndQuery,
      headers: {
        'content-type': 'application/json',
        'WM_SEC.TIMESTAMP': timestamp,
        'WM_SEC.SIGNATURE': signature,
        'x-tenant-id': '22222222-2222-2222-2222-222222222222',
      },
      payload: body,
    })

    expect(res.statusCode).toBe(200)
    expect(mockWithTenantDb).toHaveBeenCalledWith(TENANT_ID, expect.any(Function))
    expect(mockHandleWalmartWebhook).toHaveBeenCalledWith(
      TENANT_ID,
      'walmart:REPORT',
      expect.objectContaining({
        source: expect.objectContaining({ eventId: 'evt-1' }),
      }),
    )
    expect(capturedRows[0]).toMatchObject({
      tenantId: TENANT_ID,
      platform: 'walmart',
      webhookId: 'evt-1',
      topic: 'walmart:REPORT',
    })
    await app.close()
  })

  it('rejects invalid signatures', async () => {
    const app = buildApp()
    const body = JSON.stringify({ source: { eventId: 'evt-1' }, payload: { notificationType: 'REPORT' } })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/walmart?tenantId=${TENANT_ID}`,
      headers: {
        'content-type': 'application/json',
        'WM_SEC.TIMESTAMP': String(Math.floor(Date.now() / 1000)),
        'WM_SEC.SIGNATURE': 'invalid-signature',
      },
      payload: body,
    })

    expect(res.statusCode).toBe(401)
    expect(mockWithTenantDb).not.toHaveBeenCalled()
    expect(mockHandleWalmartWebhook).not.toHaveBeenCalled()
    await app.close()
  })

  it('rejects requests without signed tenantId query', async () => {
    const app = buildApp()
    const body = JSON.stringify({ source: { eventId: 'evt-1' }, payload: { notificationType: 'REPORT' } })
    const pathAndQuery = '/api/v1/webhooks/walmart'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = sign(pathAndQuery, body, timestamp)

    const res = await app.inject({
      method: 'POST',
      url: pathAndQuery,
      headers: {
        'content-type': 'application/json',
        'WM_SEC.TIMESTAMP': timestamp,
        'WM_SEC.SIGNATURE': signature,
      },
      payload: body,
    })

    expect(res.statusCode).toBe(400)
    expect(mockWithTenantDb).not.toHaveBeenCalled()
    await app.close()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import amazonWebhookRoute from './webhook.js'

vi.mock('@patioer/db', () => ({
  withTenantDb: vi.fn(),
  schema: {
    webhookEvents: 'webhook_events',
  },
}))

const { withTenantDb } = await import('@patioer/db')

function buildApp() {
  const app = Fastify()
  app.register(amazonWebhookRoute)
  return app
}

const notificationBase = {
  Type: 'Notification',
  MessageId: 'msg-001',
  Subject: 'ORDER_CHANGE',
  Timestamp: '2024-01-01T00:00:00Z',
  Message: '{}',
}

const subscriptionConfirmation = {
  Type: 'SubscriptionConfirmation',
  MessageId: 'sub-001',
  SubscribeURL: 'https://sns.amazonaws.com/confirm',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/v1/webhooks/amazon', () => {
  it('returns 400 for invalid JSON body (text/plain)', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/amazon',
      headers: { 'content-type': 'text/plain' },
      payload: 'not-json',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/invalid JSON/)
  })

  it('returns 200 immediately for SubscriptionConfirmation without persisting (text/plain)', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/amazon',
      headers: { 'content-type': 'text/plain' },
      payload: JSON.stringify(subscriptionConfirmation),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
    expect(withTenantDb).not.toHaveBeenCalled()
  })

  it('returns 400 when x-tenant-id header is missing (text/plain)', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/amazon',
      headers: { 'content-type': 'text/plain' },
      payload: JSON.stringify(notificationBase),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('x-tenant-id header is required')
  })

  it('persists notification and returns ok:true on success (text/plain)', async () => {
    vi.mocked(withTenantDb).mockImplementation(async (_tenantId, fn) => {
      await fn({
        insert: () => ({
          values: () => ({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
        }),
      } as never)
    })
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/amazon',
      headers: {
        'content-type': 'text/plain',
        'x-tenant-id': 'tenant-123',
      },
      payload: JSON.stringify(notificationBase),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
    expect(withTenantDb).toHaveBeenCalledWith('tenant-123', expect.any(Function))
  })

  it('returns 500 when db insert fails (text/plain)', async () => {
    vi.mocked(withTenantDb).mockRejectedValue(new Error('db down'))
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/amazon',
      headers: {
        'content-type': 'text/plain',
        'x-tenant-id': 'tenant-123',
      },
      payload: JSON.stringify(notificationBase),
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toBe('failed to persist notification')
  })

  it('returns 200 when content-type is application/json (pre-parsed body)', async () => {
    vi.mocked(withTenantDb).mockImplementation(async (_tenantId, fn) => {
      await fn({
        insert: () => ({
          values: () => ({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
        }),
      } as never)
    })
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/amazon',
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': 'tenant-123',
      },
      payload: JSON.stringify(notificationBase),
    })
    expect(res.statusCode).toBe(200)
  })
})

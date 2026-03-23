import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockListTenantIds,
  mockWithTenantDb,
  mockMarkWebhookProcessed,
  mockMarkWebhookFailed,
  mockHandleWebhookTopic,
  mockDispatchWebhook,
} = vi.hoisted(() => ({
  mockListTenantIds: vi.fn(),
  mockWithTenantDb: vi.fn(),
  mockMarkWebhookProcessed: vi.fn(),
  mockMarkWebhookFailed: vi.fn(),
  mockHandleWebhookTopic: vi.fn(),
  mockDispatchWebhook: vi.fn(),
}))

vi.mock('@patioer/db', () => ({
  listTenantIds: mockListTenantIds,
  withTenantDb: mockWithTenantDb,
  schema: {
    webhookEvents: {
      id: 'id',
      tenantId: 'tenantId',
      platform: 'platform',
      topic: 'topic',
      payload: 'payload',
      status: 'status',
      receivedAt: 'receivedAt',
    },
  },
  eq: vi.fn(),
  and: vi.fn(),
  lt: vi.fn(),
  inArray: vi.fn(),
}))

vi.mock('./webhook-dedup.js', () => ({
  markWebhookProcessed: mockMarkWebhookProcessed,
  markWebhookFailed: mockMarkWebhookFailed,
}))

vi.mock('./webhook-topic-handler.js', () => ({
  handleWebhookTopic: mockHandleWebhookTopic,
  dispatchWebhook: mockDispatchWebhook,
}))

import { replayPendingWebhooks } from './webhook-replay.js'

const TENANT_ID = 'tttttttt-tttt-tttt-tttt-tttttttttttt'

const SHOPIFY_EVENT = {
  id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  tenantId: TENANT_ID,
  platform: 'shopify',
  topic: 'orders/create',
  payload: { id: 42 },
}

const AMAZON_EVENT = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  tenantId: TENANT_ID,
  platform: 'amazon',
  topic: 'amazon:ORDER_CHANGE',
  payload: { orderId: '123' },
}

function setupMocks(events: unknown[]) {
  mockListTenantIds.mockResolvedValue([TENANT_ID])

  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(events),
  }
  const eventDb = { select: vi.fn().mockReturnValue(selectChain), _chain: selectChain }

  mockWithTenantDb.mockImplementation(async (_tid: string, cb: (db: unknown) => Promise<unknown>) =>
    await cb(eventDb),
  )

  return { eventDb, selectChain }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMarkWebhookProcessed.mockResolvedValue(undefined)
  mockMarkWebhookFailed.mockResolvedValue(undefined)
  mockHandleWebhookTopic.mockResolvedValue(undefined)
  mockDispatchWebhook.mockResolvedValue(undefined)
})

describe('replayPendingWebhooks', () => {
  it('dispatches shopify events via handleWebhookTopic', async () => {
    setupMocks([SHOPIFY_EVENT])

    const result = await replayPendingWebhooks({ retryAfterMs: 60_000 })

    expect(mockHandleWebhookTopic).toHaveBeenCalledOnce()
    expect(mockHandleWebhookTopic).toHaveBeenCalledWith('orders/create', TENANT_ID, SHOPIFY_EVENT.payload)
    expect(mockDispatchWebhook).not.toHaveBeenCalled()
    expect(result).toEqual({ total: 1, processed: 1, failed: 0 })
  })

  it('dispatches non-shopify events via dispatchWebhook', async () => {
    setupMocks([AMAZON_EVENT])

    const result = await replayPendingWebhooks()

    expect(mockDispatchWebhook).toHaveBeenCalledOnce()
    expect(mockDispatchWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'amazon',
        topic: 'amazon:ORDER_CHANGE',
        tenantId: TENANT_ID,
      }),
    )
    expect(mockHandleWebhookTopic).not.toHaveBeenCalled()
    expect(result).toEqual({ total: 1, processed: 1, failed: 0 })
  })

  it('returns empty result when no pending events', async () => {
    setupMocks([])

    const result = await replayPendingWebhooks()

    expect(mockHandleWebhookTopic).not.toHaveBeenCalled()
    expect(mockDispatchWebhook).not.toHaveBeenCalled()
    expect(result).toEqual({ total: 0, processed: 0, failed: 0 })
  })

  it('marks replayed webhook as processed on success', async () => {
    setupMocks([SHOPIFY_EVENT])

    await replayPendingWebhooks()

    expect(mockMarkWebhookProcessed).toHaveBeenCalledOnce()
    expect(mockMarkWebhookProcessed).toHaveBeenCalledWith(expect.anything(), SHOPIFY_EVENT.id)
  })

  it('marks replayed webhook as failed on handler error', async () => {
    setupMocks([SHOPIFY_EVENT])
    mockHandleWebhookTopic.mockRejectedValueOnce(new Error('handler boom'))

    const result = await replayPendingWebhooks()

    expect(result.failed).toBe(1)
    expect(result.processed).toBe(0)
    expect(mockMarkWebhookFailed).toHaveBeenCalledOnce()
    expect(mockMarkWebhookFailed).toHaveBeenCalledWith(expect.anything(), SHOPIFY_EVENT.id, 'handler boom')
  })

  it('does not mark webhook failed when handler succeeds but markWebhookProcessed fails', async () => {
    setupMocks([SHOPIFY_EVENT])
    mockMarkWebhookProcessed.mockRejectedValueOnce(new Error('status write failed'))

    const result = await replayPendingWebhooks()

    expect(mockHandleWebhookTopic).toHaveBeenCalledOnce()
    expect(mockMarkWebhookFailed).not.toHaveBeenCalled()
    expect(result).toEqual({ total: 1, processed: 0, failed: 1 })
  })

  it('passes remaining capacity as limit to the per-tenant query', async () => {
    const { selectChain } = setupMocks([SHOPIFY_EVENT])

    await replayPendingWebhooks({ limit: 10 })

    expect(selectChain.limit).toHaveBeenCalledWith(10)
  })

  it('handles mixed-platform events in a single batch', async () => {
    setupMocks([SHOPIFY_EVENT, AMAZON_EVENT])

    const result = await replayPendingWebhooks()

    expect(mockHandleWebhookTopic).toHaveBeenCalledOnce()
    expect(mockDispatchWebhook).toHaveBeenCalledOnce()
    expect(result).toEqual({ total: 2, processed: 2, failed: 0 })
  })

  it('stops processing additional tenants once global limit is reached', async () => {
    mockListTenantIds.mockResolvedValue(['tenant-a', 'tenant-b'])

    mockWithTenantDb.mockImplementation(
      async (_tid: string, cb: (db: unknown) => Promise<unknown>) => {
        const selectChain = {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([SHOPIFY_EVENT]),
        }
        return await cb({ select: vi.fn().mockReturnValue(selectChain) })
      },
    )

    const result = await replayPendingWebhooks({ limit: 1 })

    expect(result.total).toBe(1)
    expect(mockHandleWebhookTopic).toHaveBeenCalledOnce()
  })
})

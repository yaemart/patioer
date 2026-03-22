import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect, mockWithTenantDb, mockMarkWebhookProcessed, mockMarkWebhookFailed } =
  vi.hoisted(() => ({
    mockDbSelect: vi.fn(),
    mockWithTenantDb: vi.fn(),
    mockMarkWebhookProcessed: vi.fn(),
    mockMarkWebhookFailed: vi.fn(),
  }))

vi.mock('@patioer/db', () => ({
  db: {
    select: mockDbSelect,
  },
  withTenantDb: mockWithTenantDb,
  schema: {
    tenants: { id: 'id' },
    webhookEvents: {
      id: 'id',
      tenantId: 'tenantId',
      topic: 'topic',
      payload: 'payload',
      status: 'status',
      receivedAt: 'receivedAt',
    },
  },
  eq: vi.fn(),
  and: vi.fn(),
  lt: vi.fn(),
}))

vi.mock('./webhook-dedup.js', () => ({
  markWebhookProcessed: mockMarkWebhookProcessed,
  markWebhookFailed: mockMarkWebhookFailed,
}))

import { replayPendingWebhooks } from './webhook-replay.js'

const TENANT_ID = 'tttttttt-tttt-tttt-tttt-tttttttttttt'

const PENDING_EVENT = {
  id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  tenantId: TENANT_ID,
  topic: 'orders/create',
  payload: { id: 42 },
}

/**
 * Sets up the two-level DB mock:
 *  1. global db.select().from()    → [{id: TENANT_ID}]  (tenants, no RLS)
 *  2. withTenantDb SELECT callback  → events list        (per-tenant, RLS)
 *  3. withTenantDb mark* callbacks  → markWebhookProcessed/Failed are mocked
 */
function setupMocks(events: unknown[]) {
  // tenants query: db.select({id}).from(tenants)
  mockDbSelect.mockReturnValue({
    from: vi.fn().mockResolvedValue([{ id: TENANT_ID }]),
  })

  // SELECT chain for webhook_events inside withTenantDb
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
})

describe('replayPendingWebhooks', () => {
  it('processes received webhooks older than retryAfterMs', async () => {
    setupMocks([PENDING_EVENT])
    const handler = vi.fn().mockResolvedValue(undefined)

    const result = await replayPendingWebhooks(handler, { retryAfterMs: 60_000 })

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith('orders/create', PENDING_EVENT.tenantId, PENDING_EVENT.payload)
    expect(result.total).toBe(1)
    expect(result.processed).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('skips already-processed webhooks (returns empty from query)', async () => {
    setupMocks([])
    const handler = vi.fn()

    const result = await replayPendingWebhooks(handler)

    expect(handler).not.toHaveBeenCalled()
    expect(result.total).toBe(0)
    expect(result.processed).toBe(0)
  })

  it('marks replayed webhook as processed on success', async () => {
    setupMocks([PENDING_EVENT])
    const handler = vi.fn().mockResolvedValue(undefined)

    await replayPendingWebhooks(handler)

    expect(mockMarkWebhookProcessed).toHaveBeenCalledOnce()
    expect(mockMarkWebhookProcessed).toHaveBeenCalledWith(
      expect.anything(),
      PENDING_EVENT.id,
    )
  })

  it('marks replayed webhook as failed on handler error', async () => {
    setupMocks([PENDING_EVENT])
    const handler = vi.fn().mockRejectedValue(new Error('handler boom'))

    const result = await replayPendingWebhooks(handler)

    expect(result.failed).toBe(1)
    expect(result.processed).toBe(0)
    expect(mockMarkWebhookFailed).toHaveBeenCalledOnce()
    expect(mockMarkWebhookFailed).toHaveBeenCalledWith(
      expect.anything(),
      PENDING_EVENT.id,
      'handler boom',
    )
  })

  it('does not mark webhook failed when handler succeeds but markWebhookProcessed fails', async () => {
    setupMocks([PENDING_EVENT])
    const handler = vi.fn().mockResolvedValue(undefined)
    mockMarkWebhookProcessed.mockRejectedValueOnce(new Error('status write failed'))

    const result = await replayPendingWebhooks(handler)

    expect(handler).toHaveBeenCalledOnce()
    expect(mockMarkWebhookFailed).not.toHaveBeenCalled()
    expect(result.processed).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('passes remaining capacity as limit to the per-tenant query', async () => {
    const { selectChain } = setupMocks([PENDING_EVENT])
    const handler = vi.fn().mockResolvedValue(undefined)

    await replayPendingWebhooks(handler, { limit: 10 })

    expect(selectChain.limit).toHaveBeenCalledWith(10)
  })

  it('returns correct ReplayResult counts across multiple events', async () => {
    const events = [
      { ...PENDING_EVENT, id: 'id-1' },
      { ...PENDING_EVENT, id: 'id-2' },
      { ...PENDING_EVENT, id: 'id-3' },
    ]
    setupMocks(events)

    const handler = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined)

    const result = await replayPendingWebhooks(handler)

    expect(result.total).toBe(3)
    expect(result.processed).toBe(2)
    expect(result.failed).toBe(1)
  })

  it('queries webhook_events inside withTenantDb (RLS-enforced context)', async () => {
    setupMocks([PENDING_EVENT])
    const handler = vi.fn().mockResolvedValue(undefined)

    await replayPendingWebhooks(handler)

    // First withTenantDb call must use the correct tenant ID (SELECT)
    expect(mockWithTenantDb).toHaveBeenCalledWith(TENANT_ID, expect.any(Function))
  })

  it('stops processing additional tenants once global limit is reached', async () => {
    // Two tenants, limit=1 — only the first tenant's event should be processed
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockResolvedValue([{ id: 'tenant-a' }, { id: 'tenant-b' }]),
    })

    let callCount = 0
    mockWithTenantDb.mockImplementation(
      async (_tid: string, cb: (db: unknown) => Promise<unknown>) => {
        callCount++
        const selectChain = {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([PENDING_EVENT]),
        }
        return await cb({ select: vi.fn().mockReturnValue(selectChain) })
      },
    )

    const handler = vi.fn().mockResolvedValue(undefined)
    const result = await replayPendingWebhooks(handler, { limit: 1 })

    expect(result.total).toBe(1)
    expect(handler).toHaveBeenCalledOnce()
  })
})

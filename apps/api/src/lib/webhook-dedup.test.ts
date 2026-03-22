import { describe, expect, it, vi } from 'vitest'
import {
  recordWebhookIfNew,
  markWebhookProcessed,
  markWebhookFailed,
  type WebhookMeta,
} from './webhook-dedup.js'
import type { AppDb } from '@patioer/db'

const META: WebhookMeta = {
  webhookId: 'wh-123',
  topic: 'orders/create',
  shopDomain: 'test.myshopify.com',
  tenantId: 'tttttttt-tttt-tttt-tttt-tttttttttttt',
}

const PAYLOAD = { id: 42, total_price: '99.00' }
const EVENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

/**
 * Builds a minimal AppDb mock for recordWebhookIfNew.
 * The new implementation uses a single:
 *   INSERT ... ON CONFLICT DO NOTHING ... RETURNING
 * so the mock only needs insert().values().onConflictDoNothing().returning().
 * `returningRows` controls whether the insert "won" the race (non-empty) or
 * was a duplicate (empty array, because ON CONFLICT DO NOTHING fired).
 */
function makeInsertDb(returningRows: unknown[] = [{ id: EVENT_ID }]): AppDb {
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returningRows),
  }
  return {
    insert: vi.fn().mockReturnValue(insertChain),
  } as unknown as AppDb
}

describe('recordWebhookIfNew', () => {
  it('inserts new webhook event and returns duplicate=false', async () => {
    const db = makeInsertDb([{ id: EVENT_ID }])
    const result = await recordWebhookIfNew(db, META, PAYLOAD)

    expect(result.duplicate).toBe(false)
    expect(result.eventId).toBe(EVENT_ID)
    expect(db.insert).toHaveBeenCalledOnce()
  })

  it('returns duplicate=true when ON CONFLICT fires (empty RETURNING)', async () => {
    // Simulates the scenario where the unique index (tenantId, webhookId) already
    // exists — ON CONFLICT DO NOTHING causes RETURNING to yield zero rows.
    const db = makeInsertDb([])
    const result = await recordWebhookIfNew(db, META, PAYLOAD)

    expect(result.duplicate).toBe(true)
    expect(result.eventId).toBeUndefined()
    // insert IS still called — the atomicity is handled by the DB, not by a prior SELECT
    expect(db.insert).toHaveBeenCalledOnce()
  })

  it('stores full payload as JSONB', async () => {
    const db = makeInsertDb()
    await recordWebhookIfNew(db, META, PAYLOAD)

    const insertMock = db.insert as ReturnType<typeof vi.fn>
    const valuesMock = insertMock.mock.results[0].value.values as ReturnType<typeof vi.fn>
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ payload: PAYLOAD }),
    )
  })

  it('stores correct topic, shopDomain, and initial status', async () => {
    const db = makeInsertDb()
    await recordWebhookIfNew(db, META, PAYLOAD)

    const insertMock = db.insert as ReturnType<typeof vi.fn>
    const valuesMock = insertMock.mock.results[0].value.values as ReturnType<typeof vi.fn>
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'orders/create',
        shopDomain: 'test.myshopify.com',
        status: 'received',
      }),
    )
  })

  it('always calls onConflictDoNothing (no separate SELECT)', async () => {
    const db = makeInsertDb()
    await recordWebhookIfNew(db, META, PAYLOAD)

    const insertMock = db.insert as ReturnType<typeof vi.fn>
    const chain = insertMock.mock.results[0].value as {
      onConflictDoNothing: ReturnType<typeof vi.fn>
    }
    // Ensures the race-safe path is taken on every call
    expect(chain.onConflictDoNothing).toHaveBeenCalledOnce()
  })

  it('stores the webhookId and tenantId', async () => {
    const db = makeInsertDb()
    await recordWebhookIfNew(db, META, PAYLOAD)

    const insertMock = db.insert as ReturnType<typeof vi.fn>
    const valuesMock = insertMock.mock.results[0].value.values as ReturnType<typeof vi.fn>
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookId: META.webhookId,
        tenantId: META.tenantId,
      }),
    )
  })
})

describe('markWebhookProcessed', () => {
  it('sets status to processed and processedAt timestamp', async () => {
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    }
    const db = { update: vi.fn().mockReturnValue(updateChain) } as unknown as AppDb

    await markWebhookProcessed(db, EVENT_ID)

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'processed', processedAt: expect.any(Date) }),
    )
    expect(updateChain.where).toHaveBeenCalledOnce()
  })
})

describe('markWebhookFailed', () => {
  it('sets status to failed and stores error message', async () => {
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    }
    const db = { update: vi.fn().mockReturnValue(updateChain) } as unknown as AppDb

    await markWebhookFailed(db, EVENT_ID, 'tenant not found')

    expect(updateChain.set).toHaveBeenCalledWith({
      status: 'failed',
      errorMessage: 'tenant not found',
    })
    expect(updateChain.where).toHaveBeenCalledOnce()
  })
})

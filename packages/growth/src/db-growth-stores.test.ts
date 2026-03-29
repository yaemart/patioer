import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state, schemaMock, dbMock, mockWithTenantDb } = vi.hoisted(() => {
  const schemaMock = {
    referralCodes: {
      __table: 'referralCodes',
      id: 'id',
      tenantId: 'tenantId',
      code: 'code',
      createdAt: 'createdAt',
    },
    referralRewards: {
      __table: 'referralRewards',
      id: 'id',
      referrerTenantId: 'referrerTenantId',
      newTenantId: 'newTenantId',
      rewardType: 'rewardType',
      status: 'status',
      createdAt: 'createdAt',
    },
    npsResponses: {
      __table: 'npsResponses',
      id: 'id',
      tenantId: 'tenantId',
      score: 'score',
      feedback: 'feedback',
      createdAt: 'createdAt',
    },
  }

  const state = {
    referralCodes: [] as Array<Record<string, unknown>>,
    referralRewards: [] as Array<Record<string, unknown>>,
    npsResponses: [] as Array<Record<string, unknown>>,
  }

  function rowsFor(table: { __table: string }): Array<Record<string, unknown>> {
    switch (table.__table) {
      case 'referralCodes':
        return state.referralCodes
      case 'referralRewards':
        return state.referralRewards
      case 'npsResponses':
        return state.npsResponses
      default:
        return []
    }
  }

  function makeSelectResult(
    rows: Array<Record<string, unknown>>,
    fields?: Record<string, unknown>,
  ) {
    if (fields && 'id' in fields) {
      return rows.map((row) => ({ id: row.id }))
    }
    return rows
  }

  function makeTenantDb(tenantId: string) {
    return {
      select: vi.fn((fields?: Record<string, unknown>) => ({
        from: vi.fn((table: { __table: string }) => ({
          where: vi.fn((predicate?: (row: Record<string, unknown>) => boolean) => {
            const rows = rowsFor(table).filter((row) => {
              const belongsToTenant =
                row.tenantId === tenantId ||
                row.referrerTenantId === tenantId
              return belongsToTenant && (predicate ? predicate(row) : true)
            })
            const result = makeSelectResult(rows, fields)
            return {
              limit: vi.fn(async (count: number) => result.slice(0, count)),
              then<TResult1 = typeof result, TResult2 = never>(
                onfulfilled?: ((value: typeof result) => TResult1 | PromiseLike<TResult1>) | null,
                onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
              ) {
                return Promise.resolve(result).then(onfulfilled, onrejected)
              },
            }
          }),
        })),
      })),
      insert: vi.fn((table: { __table: string }) => ({
        values: vi.fn(async (value: Record<string, unknown>) => {
          rowsFor(table).push({ ...value })
        }),
      })),
    }
  }

  const dbMock = {
    select: vi.fn((fields?: Record<string, unknown>) => ({
      from: vi.fn((table: { __table: string }) => ({
        where: vi.fn((predicate?: (row: Record<string, unknown>) => boolean) => {
          const rows = rowsFor(table).filter((row) => (predicate ? predicate(row) : true))
          const result = makeSelectResult(rows, fields)
          return {
            limit: vi.fn(async (count: number) => result.slice(0, count)),
          }
        }),
      })),
    })),
    insert: vi.fn((table: { __table: string }) => ({
      values: vi.fn(async (value: Record<string, unknown>) => {
        rowsFor(table).push({ ...value })
      }),
    })),
    update: vi.fn((table: { __table: string }) => ({
      set: vi.fn((value: Record<string, unknown>) => ({
        where: vi.fn(async (predicate: (row: Record<string, unknown>) => boolean) => {
          for (const row of rowsFor(table)) {
            if (predicate(row)) Object.assign(row, value)
          }
        }),
      })),
    })),
  }

  const mockWithTenantDb = vi.fn(
    async (tenantId: string, cb: (tenantDb: ReturnType<typeof makeTenantDb>) => Promise<unknown>) =>
      cb(makeTenantDb(tenantId)),
  )

  return { state, schemaMock, dbMock, mockWithTenantDb }
})

vi.mock('@patioer/db', () => ({
  db: dbMock,
  withTenantDb: mockWithTenantDb,
  schema: schemaMock,
}))

vi.mock('drizzle-orm', () => ({
  eq: (column: string, value: unknown) => (row: Record<string, unknown>) => row[column] === value,
  and: (...predicates: Array<(row: Record<string, unknown>) => boolean>) =>
    (row: Record<string, unknown>) => predicates.every((predicate) => predicate(row)),
}))

import {
  createDbNpsStore,
  createDbReferralStore,
  createDbRewardStore,
} from './db-growth-stores.js'

describe('db growth stores', () => {
  beforeEach(() => {
    state.referralCodes.length = 0
    state.referralRewards.length = 0
    state.npsResponses.length = 0
    vi.clearAllMocks()
  })

  it('creates and reads referral codes for a tenant', async () => {
    const store = createDbReferralStore()

    await store.create({
      id: 'ref-1',
      tenantId: 'tenant-a',
      code: 'ELEC-AB12',
      createdAt: new Date('2026-03-29T00:00:00.000Z'),
    })

    await expect(store.findByTenantId('tenant-a')).resolves.toMatchObject({
      id: 'ref-1',
      tenantId: 'tenant-a',
      code: 'ELEC-AB12',
    })
  })

  it('finds referral code by single global lookup', async () => {
    const store = createDbReferralStore()

    await store.create({
      id: 'ref-2',
      tenantId: 'tenant-b',
      code: 'ELEC-CD34',
      createdAt: new Date('2026-03-29T00:00:00.000Z'),
    })

    await expect(store.findByCode('ELEC-CD34')).resolves.toMatchObject({
      tenantId: 'tenant-b',
      code: 'ELEC-CD34',
    })
  })

  it('creates rewards and updates pending reward status', async () => {
    const store = createDbRewardStore()

    await store.create({
      id: 'reward-1',
      referrerTenantId: 'tenant-b',
      newTenantId: 'tenant-c',
      rewardType: '20_pct_discount_1_month',
      status: 'pending',
      createdAt: new Date('2026-03-29T00:00:00.000Z'),
    })

    await expect(store.findPendingForNewTenant('tenant-c')).resolves.toMatchObject({
      id: 'reward-1',
      referrerTenantId: 'tenant-b',
      status: 'pending',
    })

    await store.updateStatus('reward-1', 'fulfilled')

    await expect(store.findPendingForNewTenant('tenant-c')).resolves.toBeNull()
  })

  it('records and retrieves NPS responses per tenant', async () => {
    const store = createDbNpsStore()

    await expect(store.hasReceivedNps('tenant-a')).resolves.toBe(false)

    await store.recordResponse({
      id: 'nps-1',
      tenantId: 'tenant-a',
      score: 9,
      feedback: 'Great',
    })

    await expect(store.hasReceivedNps('tenant-a')).resolves.toBe(true)
    await expect(store.getResponses('tenant-a')).resolves.toEqual([
      expect.objectContaining({
        id: 'nps-1',
        tenantId: 'tenant-a',
        score: 9,
        feedback: 'Great',
      }),
    ])
  })
})

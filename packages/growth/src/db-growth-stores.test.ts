import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  state,
  schemaMock,
  dbMock,
  mockWithTenantDb,
} = vi.hoisted(() => {
  const schemaMock = {
    tenants: { __table: 'tenants', id: 'id' },
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
    tenants: [
      { id: 'tenant-a' },
      { id: 'tenant-b' },
      { id: 'tenant-c' },
    ],
    referralCodes: new Map<string, Array<Record<string, unknown>>>(),
    referralRewards: new Map<string, Array<Record<string, unknown>>>(),
    npsResponses: new Map<string, Array<Record<string, unknown>>>(),
  }

  function getTenantRows(
    table: { __table: string },
    tenantId: string,
  ): Array<Record<string, unknown>> {
    if (table.__table === 'referralCodes') {
      const rows = state.referralCodes.get(tenantId)
      if (rows) return rows
      const created: Array<Record<string, unknown>> = []
      state.referralCodes.set(tenantId, created)
      return created
    }

    if (table.__table === 'referralRewards') {
      const rows = state.referralRewards.get(tenantId)
      if (rows) return rows
      const created: Array<Record<string, unknown>> = []
      state.referralRewards.set(tenantId, created)
      return created
    }

    const rows = state.npsResponses.get(tenantId)
    if (rows) return rows
    const created: Array<Record<string, unknown>> = []
    state.npsResponses.set(tenantId, created)
    return created
  }

  function makeTenantDb(tenantId: string) {
    function selectRows(
      table: { __table: string },
      fields?: Record<string, unknown>,
      predicate?: (row: Record<string, unknown>) => boolean,
      count?: number,
    ) {
      const rows = getTenantRows(table, tenantId)
        .filter((row) => (predicate ? predicate(row) : true))
      const limited = typeof count === 'number' ? rows.slice(0, count) : rows
      if (fields && 'id' in fields) {
        return limited.map((row) => ({ id: row.id }))
      }
      return limited
    }

    return {
      select: vi.fn((fields?: Record<string, unknown>) => ({
        from: vi.fn((table: { __table: string }) => ({
          where: vi.fn((predicate?: (row: Record<string, unknown>) => boolean) => {
            const rows = selectRows(table, fields, predicate)
            return {
              limit: vi.fn(async (count: number) => selectRows(table, fields, predicate, count)),
              then<TResult1 = typeof rows, TResult2 = never>(
                onfulfilled?: ((value: typeof rows) => TResult1 | PromiseLike<TResult1>) | null,
                onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
              ) {
                return Promise.resolve(rows).then(onfulfilled, onrejected)
              },
            }
          }),
        })),
      })),
      insert: vi.fn((table: { __table: string }) => ({
        values: vi.fn(async (value: Record<string, unknown>) => {
          getTenantRows(table, tenantId).push({ ...value })
        }),
      })),
      update: vi.fn((table: { __table: string }) => ({
        set: vi.fn((value: Record<string, unknown>) => ({
          where: vi.fn(async (predicate: (row: Record<string, unknown>) => boolean) => {
            const rows = getTenantRows(table, tenantId)
            for (const row of rows) {
              if (predicate(row)) Object.assign(row, value)
            }
          }),
        })),
      })),
    }
  }

  const dbMock = {
    select: vi.fn((_fields: Record<string, unknown>) => ({
      from: vi.fn(async () => state.tenants.map((tenant) => ({ id: tenant.id }))),
    })),
  }

  const mockWithTenantDb = vi.fn(
    async (tenantId: string, cb: (tenantDb: ReturnType<typeof makeTenantDb>) => Promise<unknown>) =>
      cb(makeTenantDb(tenantId)),
  )

  return {
    state,
    schemaMock,
    dbMock,
    mockWithTenantDb,
  }
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
    state.referralCodes.clear()
    state.referralRewards.clear()
    state.npsResponses.clear()
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

  it('finds referral code across tenant partitions', async () => {
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

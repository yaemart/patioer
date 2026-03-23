import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockWithTenantDb,
  mockResolveFirstCredentialForTenant,
  mockGetOrCreate,
  mockHarnessUpdatePrice,
  mockHarnessUpdateAdsBudget,
  mockHarnessUpdateInventory,
} = vi.hoisted(() => ({
  mockWithTenantDb: vi.fn(),
  mockResolveFirstCredentialForTenant: vi.fn(),
  mockGetOrCreate: vi.fn(),
  mockHarnessUpdatePrice: vi.fn(),
  mockHarnessUpdateAdsBudget: vi.fn(),
  mockHarnessUpdateInventory: vi.fn(),
}))

vi.mock('@patioer/db', async () => {
  const actual = await vi.importActual<typeof import('@patioer/db')>('@patioer/db')
  return {
    ...actual,
    withTenantDb: mockWithTenantDb,
  }
})

vi.mock('./resolve-credential.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./resolve-credential.js')>()
  return {
    ...actual,
    resolveFirstCredentialForTenant: mockResolveFirstCredentialForTenant,
  }
})

vi.mock('./harness-registry.js', () => ({
  registry: {
    getOrCreate: mockGetOrCreate,
    invalidate: vi.fn(),
  },
}))

vi.mock('./harness-factory.js', () => ({
  createHarness: vi.fn(() => ({
    updatePrice: mockHarnessUpdatePrice,
    updateAdsBudget: mockHarnessUpdateAdsBudget,
    updateInventory: mockHarnessUpdateInventory,
  })),
}))

import { processApprovalExecuteJob } from './approval-execute-worker.js'

const TENANT = '123e4567-e89b-12d3-a456-426614174000'
const AGENT = '123e4567-e89b-12d3-a456-426614174001'
const APPROVAL = '123e4567-e89b-12d3-a456-426614174002'

beforeEach(() => {
  vi.clearAllMocks()
  mockHarnessUpdatePrice.mockResolvedValue(undefined)
  mockHarnessUpdateAdsBudget.mockResolvedValue(undefined)
  mockHarnessUpdateInventory.mockResolvedValue(undefined)
  mockResolveFirstCredentialForTenant.mockResolvedValue({
    cred: { accessToken: 't', shopDomain: 'test.myshopify.com' },
    platform: 'shopify',
  })
  mockGetOrCreate.mockImplementation((_key: string, factory: () => unknown) => factory())

  mockWithTenantDb.mockImplementation(async (_tid: string, cb: (db: unknown) => Promise<unknown>) => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    }
    return cb(db)
  })
})

describe('processApprovalExecuteJob', () => {
  it('applies price.update via harness and logs approval.executed', async () => {
    const inserts: unknown[] = []
    mockWithTenantDb.mockImplementation(async (_tid: string, cb: (db: unknown) => Promise<unknown>) => {
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockImplementation((_table: unknown) => ({
          values: vi.fn().mockImplementation((v: unknown) => {
            inserts.push(v)
            return Promise.resolve(undefined)
          }),
        })),
      }
      return cb(db)
    })

    await processApprovalExecuteJob({
      tenantId: TENANT,
      agentId: AGENT,
      approvalId: APPROVAL,
      action: 'price.update',
      payload: {
        productId: '42',
        proposedPrice: 19.99,
        currentPrice: 18,
        deltaPercent: 5,
        requiresApproval: true,
        reason: 'test',
      },
    })

    expect(mockHarnessUpdatePrice).toHaveBeenCalledWith('42', 19.99)
    expect(mockResolveFirstCredentialForTenant).toHaveBeenCalledWith(TENANT, null)
    expect(inserts.some((row) => (row as { action?: string }).action === 'approval.executed')).toBe(true)
  })

  it('passes job platform to resolveFirstCredentialForTenant for price.update', async () => {
    mockWithTenantDb.mockImplementation(async (_tid: string, cb: (db: unknown) => Promise<unknown>) => {
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
      }
      return cb(db)
    })

    await processApprovalExecuteJob({
      tenantId: TENANT,
      agentId: AGENT,
      approvalId: APPROVAL,
      action: 'price.update',
      payload: { productId: '42', proposedPrice: 19.99 },
      platform: 'tiktok',
    })

    expect(mockResolveFirstCredentialForTenant).toHaveBeenCalledWith(TENANT, 'tiktok')
  })

  it('skips when approval.executed already exists', async () => {
    mockWithTenantDb.mockImplementation(async (_tid: string, cb: (db: unknown) => Promise<unknown>) => {
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 'ev-1' }]),
            }),
          }),
        }),
        insert: vi.fn(),
      }
      return cb(db)
    })

    await processApprovalExecuteJob({
      tenantId: TENANT,
      agentId: AGENT,
      approvalId: APPROVAL,
      action: 'price.update',
      payload: { productId: '42', proposedPrice: 19.99 },
    })

    expect(mockHarnessUpdatePrice).not.toHaveBeenCalled()
  })

  it('records support.escalate without calling harness', async () => {
    const inserts: unknown[] = []
    mockWithTenantDb.mockImplementation(async (_tid: string, cb: (db: unknown) => Promise<unknown>) => {
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockImplementation((v: unknown) => {
            inserts.push(v)
            return Promise.resolve(undefined)
          }),
        })),
      }
      return cb(db)
    })

    await processApprovalExecuteJob({
      tenantId: TENANT,
      agentId: AGENT,
      approvalId: APPROVAL,
      action: 'support.escalate',
      payload: { threadId: 't1', subject: 'hi' },
    })

    expect(mockResolveFirstCredentialForTenant).not.toHaveBeenCalled()
    expect(inserts.some((row) => (row as { payload?: { kind?: string } }).payload?.kind === 'support.escalate')).toBe(
      true,
    )
  })

  it('applies ads.set_budget via updateAdsBudget', async () => {
    mockWithTenantDb.mockImplementation(async (_tid: string, cb: (db: unknown) => Promise<unknown>) => {
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
      }
      return cb(db)
    })

    await processApprovalExecuteJob({
      tenantId: TENANT,
      agentId: AGENT,
      approvalId: APPROVAL,
      action: 'ads.set_budget',
      payload: {
        platform: 'shopify',
        platformCampaignId: 'camp-1',
        proposedDailyBudgetUsd: 506,
      },
      platform: 'shopify',
    })

    expect(mockHarnessUpdateAdsBudget).toHaveBeenCalledWith('camp-1', 506)
    expect(mockHarnessUpdateInventory).not.toHaveBeenCalled()
  })

  it('applies inventory.adjust via updateInventory', async () => {
    mockWithTenantDb.mockImplementation(async (_tid: string, cb: (db: unknown) => Promise<unknown>) => {
      const db = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
      }
      return cb(db)
    })

    await processApprovalExecuteJob({
      tenantId: TENANT,
      agentId: AGENT,
      approvalId: APPROVAL,
      action: 'inventory.adjust',
      payload: {
        platform: 'shopify',
        platformProductId: 'p-99',
        targetQuantity: 120,
      },
      platform: 'shopify',
    })

    expect(mockHarnessUpdateInventory).toHaveBeenCalledWith('p-99', 120)
    expect(mockHarnessUpdateAdsBudget).not.toHaveBeenCalled()
  })
})

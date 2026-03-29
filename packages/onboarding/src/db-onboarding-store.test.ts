import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingMachine, createInitialState } from './onboarding-machine.js'

const { mockWithTenantDb, dbState, fakeDb } = vi.hoisted(() => {
  const dbState: { row: Record<string, unknown> | null } = { row: null }
  const fakeDb = {
    select: vi.fn((fields?: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            if (!dbState.row) return []
            if (fields && 'id' in fields) {
              return [{ id: dbState.row.id }]
            }
            return [dbState.row]
          }),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        dbState.row = {
          id: dbState.row?.id ?? 'progress-1',
          ...values,
        }
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          dbState.row = {
            ...(dbState.row ?? { id: 'progress-1' }),
            ...values,
          }
        }),
      })),
    })),
  }

  return {
    mockWithTenantDb: vi.fn(async (_tenantId: string, cb: (db: typeof fakeDb) => Promise<unknown>) => cb(fakeDb)),
    dbState,
    fakeDb,
  }
})

vi.mock('@patioer/db', () => ({
  withTenantDb: mockWithTenantDb,
  schema: {
    onboardingProgress: {
      id: 'id',
      tenantId: 'tenant_id',
    },
  },
}))

import { createDbOnboardingStore } from './db-onboarding-store.js'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'

describe('db-onboarding-store', () => {
  beforeEach(() => {
    dbState.row = null
    vi.clearAllMocks()
    mockWithTenantDb.mockImplementation(async (_tenantId: string, cb: (db: typeof fakeDb) => Promise<unknown>) => cb(fakeDb))
  })

  it('returns null when no onboarding row exists', async () => {
    const store = createDbOnboardingStore()
    await expect(store.getState(TENANT_ID)).resolves.toBeNull()
  })

  it('inserts a new onboarding row on first save', async () => {
    const store = createDbOnboardingStore()
    const state = createInitialState()

    await store.saveState(TENANT_ID, state)

    expect(fakeDb.insert).toHaveBeenCalledOnce()
    expect(dbState.row).toMatchObject({
      tenantId: TENANT_ID,
      currentStep: 1,
      healthCheckPassed: false,
      stepData: {},
      oauthStatus: {},
    })
  })

  it('hydrates saved onboarding state from the database row', async () => {
    const startedAt = new Date('2026-03-29T00:00:00.000Z')
    const completedAt = new Date('2026-03-29T01:00:00.000Z')
    dbState.row = {
      id: 'progress-1',
      tenantId: TENANT_ID,
      currentStep: 7,
      stepData: { 4: { skipped: true } },
      oauthStatus: { shopify: 'success' },
      healthCheckPassed: true,
      startedAt,
      completedAt,
    }

    const store = createDbOnboardingStore()
    const state = await store.getState(TENANT_ID)

    expect(state).toEqual({
      currentStep: 7,
      stepData: { 4: { skipped: true } },
      oauthStatus: { shopify: 'success' },
      healthCheckPassed: true,
      startedAt,
      completedAt,
    })
  })

  it('updates an existing onboarding row on subsequent saves', async () => {
    dbState.row = {
      id: 'progress-1',
      tenantId: TENANT_ID,
      currentStep: 1,
      stepData: {},
      oauthStatus: {},
      healthCheckPassed: false,
      startedAt: new Date('2026-03-29T00:00:00.000Z'),
      completedAt: null,
    }

    const store = createDbOnboardingStore()
    await store.saveState(TENANT_ID, {
      currentStep: 3,
      stepData: { 2: { plan: 'growth' } },
      oauthStatus: { amazon: 'pending' },
      healthCheckPassed: false,
      startedAt: new Date('2026-03-29T00:00:00.000Z'),
      completedAt: null,
    })

    expect(fakeDb.update).toHaveBeenCalledOnce()
    expect(dbState.row).toMatchObject({
      id: 'progress-1',
      tenantId: TENANT_ID,
      currentStep: 3,
      stepData: { 2: { plan: 'growth' } },
      oauthStatus: { amazon: 'pending' },
    })
  })

  it('persists machine state across machine instances', async () => {
    const store = createDbOnboardingStore()
    const firstMachine = new OnboardingMachine(store)

    const firstResult = await firstMachine.advance(TENANT_ID, 1, {})
    expect(firstResult.success).toBe(true)

    const secondMachine = new OnboardingMachine(store)
    const restored = await secondMachine.getOrCreate(TENANT_ID)
    expect(restored.currentStep).toBe(2)
  })
})

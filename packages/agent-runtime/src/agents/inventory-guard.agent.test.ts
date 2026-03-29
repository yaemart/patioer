import { describe, expect, it, vi } from 'vitest'
import type { TenantHarness } from '@patioer/harness'
import type { AgentContext } from '../context.js'

vi.mock('./inventory-guard.schedule.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./inventory-guard.schedule.js')>()
  return {
    ...actual,
    /** Fixed hour so `enforceDailyWindow` tests are deterministic (not 08:00 → skip). */
    getHourInTimeZone: vi.fn().mockReturnValue(7),
  }
})

import { runInventoryGuard } from './inventory-guard.agent.js'

function baseHarness(): TenantHarness & {
  getInventoryLevels: () => Promise<{ platformProductId: string; quantity: number }[]>
} {
  return {
    tenantId: 't1',
    platformId: 'shopify',
    getProduct: vi.fn(),
    getProductsPage: vi.fn(),
    getProducts: vi.fn(),
    updatePrice: vi.fn(),
    updateInventory: vi.fn(),
    getOrdersPage: vi.fn(),
    getOrders: vi.fn(),
    replyToMessage: vi.fn(),
    getOpenThreads: vi.fn(),
    getAnalytics: vi.fn(),
    getInventoryLevels: vi.fn().mockResolvedValue([]),
  }
}

function createCtx(overrides: {
  platforms?: string[]
  harness?: ReturnType<typeof baseHarness>
  budgetExceeded?: boolean
}): AgentContext {
  const logAction = vi.fn().mockResolvedValue(undefined)
  const createTicket = vi.fn().mockResolvedValue(undefined)
  const h = overrides.harness ?? baseHarness()
  return {
    tenantId: 't1',
    agentId: 'a1',
    getHarness: () => h,
    getEnabledPlatforms: () => overrides.platforms ?? ['shopify'],
    llm: vi.fn(),
    budget: {
      isExceeded: vi.fn().mockResolvedValue(overrides.budgetExceeded ?? false),
    },
    logAction,
    requestApproval: vi.fn(),
    createTicket,
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    getRecentEvents: vi.fn().mockResolvedValue([]),
    getEventsForAgent: vi.fn().mockResolvedValue([]),
    describeDataOsCapabilities: () => 'DataOS not available',
  }
}

describe('runInventoryGuard', () => {
  it('returns empty when no platforms', async () => {
    const ctx = createCtx({ platforms: [] })
    const result = await runInventoryGuard(ctx, {})
    expect(result.synced).toBe(0)
    expect(ctx.logAction).toHaveBeenCalledWith('inventory_guard.no_platforms', expect.any(Object))
  })

  it('skips when not inventory-capable', async () => {
    const h = { ...baseHarness() }
    delete (h as { getInventoryLevels?: unknown }).getInventoryLevels
    const ctx = createCtx({ harness: h as unknown as ReturnType<typeof baseHarness> })
    const result = await runInventoryGuard(ctx, {})
    expect(result.perPlatform[0]?.skipReason).toBe('not_inventory_capable')
  })

  it('persists rows and creates ticket when below threshold', async () => {
    const h = baseHarness()
    h.getInventoryLevels = vi.fn().mockResolvedValue([{ platformProductId: 'p1', quantity: 2 }])
    const persistInventoryLevels = vi.fn().mockResolvedValue(1)
    const ctx = createCtx({ harness: h })
    const result = await runInventoryGuard(ctx, {
      safetyThreshold: 10,
      persistInventoryLevels,
    })
    expect(result.synced).toBe(1)
    expect(result.levelsPersisted).toBe(1)
    expect(persistInventoryLevels).toHaveBeenCalledWith({
      platform: 'shopify',
      levels: expect.arrayContaining([
        expect.objectContaining({
          platformProductId: 'p1',
          quantity: 2,
          status: 'low',
          safetyThreshold: 10,
        }),
      ]),
    })
    expect(ctx.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('Inventory Guard'),
      }),
    )
  })

  it('requests inventory.adjust approval when restock meets min units (never updateInventory)', async () => {
    const h = baseHarness()
    h.getInventoryLevels = vi.fn().mockResolvedValue([{ platformProductId: 'p1', quantity: 2 }])
    const ctx = createCtx({ harness: h })
    const result = await runInventoryGuard(ctx, {
      safetyThreshold: 10,
      replenishApprovalMinUnits: 5,
      hasPendingInventoryAdjust: vi.fn().mockResolvedValue(false),
    })
    expect(result.replenishApprovalsRequested).toBe(1)
    expect(ctx.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inventory.adjust',
        payload: expect.objectContaining({ platformProductId: 'p1' }),
      }),
    )
    expect(h.updateInventory).not.toHaveBeenCalled()
  })

  it('does not create ticket when all normal', async () => {
    const h = baseHarness()
    h.getInventoryLevels = vi.fn().mockResolvedValue([{ platformProductId: 'p1', quantity: 100 }])
    const ctx = createCtx({ harness: h })
    await runInventoryGuard(ctx, { safetyThreshold: 10 })
    expect(ctx.createTicket).not.toHaveBeenCalled()
  })

  it('skips run when enforceDailyWindow and hour is not 08:00 in TZ', async () => {
    const h = baseHarness()
    h.getInventoryLevels = vi.fn().mockResolvedValue([{ platformProductId: 'p1', quantity: 1 }])
    const ctx = createCtx({ harness: h })
    const result = await runInventoryGuard(ctx, {
      enforceDailyWindow: true,
      timeZone: 'UTC',
    })
    expect(result.skippedDueToSchedule).toBe(true)
    expect(h.getInventoryLevels).not.toHaveBeenCalled()
  })

  it('records harness_error when getInventoryLevels throws', async () => {
    const h = baseHarness()
    h.getInventoryLevels = vi.fn().mockRejectedValue(new Error('timeout'))
    const ctx = createCtx({ harness: h })
    const result = await runInventoryGuard(ctx, {})
    expect(result.perPlatform[0]?.skipReason).toBe('harness_error')
  })
})

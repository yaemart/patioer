import { describe, expect, it, vi } from 'vitest'
import { isInventoryCapable } from './inventory-capable.js'
import type { TenantHarness } from './base.harness.js'

function minimalHarness(extra?: { getInventoryLevels?: () => Promise<unknown[]> }): TenantHarness {
  return {
    tenantId: 't',
    platformId: 'x',
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
    ...extra,
  }
}

describe('isInventoryCapable', () => {
  it('is false without getInventoryLevels', () => {
    expect(isInventoryCapable(minimalHarness())).toBe(false)
  })

  it('is true when getInventoryLevels is a function', () => {
    const h = minimalHarness({
      getInventoryLevels: async () => [],
    })
    expect(isInventoryCapable(h)).toBe(true)
  })
})

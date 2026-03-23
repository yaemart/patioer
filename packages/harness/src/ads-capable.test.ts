import { describe, expect, it, vi } from 'vitest'
import { isAdsCapable } from './ads-capable.js'
import type { TenantHarness } from './base.harness.js'

function minimalHarness(extra?: { getAdsCampaigns?: () => Promise<unknown[]> }): TenantHarness {
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

describe('isAdsCapable', () => {
  it('is false without getAdsCampaigns', () => {
    expect(isAdsCapable(minimalHarness())).toBe(false)
  })

  it('is true when supportsAds is true and getAdsCampaigns is a function', () => {
    const h = {
      ...minimalHarness(),
      supportsAds: true as const,
      getAdsCampaigns: async () => [],
      updateAdsBudget: async () => {},
    }
    expect(isAdsCapable(h)).toBe(true)
  })

  it('is false when only getAdsCampaigns exists but supportsAds is missing', () => {
    const h = minimalHarness({
      getAdsCampaigns: async () => [],
    })
    expect(isAdsCapable(h)).toBe(false)
  })
})

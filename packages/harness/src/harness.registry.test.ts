import { describe, expect, it, vi } from 'vitest'
import type { TenantHarness } from './base.harness.js'
import { HarnessRegistry } from './harness.registry.js'
import { AmazonHarness } from './amazon.harness.js'
import { TikTokHarness } from './tiktok.harness.js'
import { ShopeeHarness } from './shopee.harness.js'
import type { AmazonCredentials } from './amazon.types.js'
import type { TikTokCredentials } from './tiktok.types.js'
import type { ShopeeCredentials } from './shopee.types.js'

const mockAmazonCreds: AmazonCredentials = {
  clientId: 'cid',
  clientSecret: 'csec',
  refreshToken: 'rt',
  sellerId: 'sid',
  marketplaceId: 'ATVPDKIKX0DER',
  region: 'na',
}

const mockTikTokCreds: TikTokCredentials = {
  appKey: 'ak',
  appSecret: 'as',
  accessToken: 'at',
  shopId: 'shop',
}

const mockShopeeCreds: ShopeeCredentials = {
  partnerId: 1,
  partnerKey: 'pk',
  accessToken: 'at',
  shopId: 2,
  market: 'SG',
}

function makeHarness(id: string): TenantHarness {
  return {
    tenantId: `tenant-${id}`,
    platformId: 'shopify',
    getProduct: vi.fn(),
    getProducts: vi.fn(),
    getProductsPage: vi.fn(),
    updatePrice: vi.fn(),
    updateInventory: vi.fn(),
    getOrders: vi.fn(),
    getOrdersPage: vi.fn(),
    replyToMessage: vi.fn(),
    getOpenThreads: vi.fn(),
    getAnalytics: vi.fn(),
  } as unknown as TenantHarness
}

describe('HarnessRegistry', () => {
  it('returns cached harness for same key', () => {
    const registry = new HarnessRegistry()
    const factory = vi.fn(() => makeHarness('1'))

    const first = registry.getOrCreate('k', factory)
    const second = registry.getOrCreate('k', factory)

    expect(first).toBe(second)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('expires entries by ttl and recreates harness', () => {
    let now = 1_000
    const registry = new HarnessRegistry(() => now)
    const factory = vi.fn(() => makeHarness(String(factory.mock.calls.length + 1)))

    const first = registry.getOrCreate('k', factory)
    now = 1_050
    const second = registry.getOrCreate('k', factory)
    now = 1_000 + 16 * 60 * 1000
    const third = registry.getOrCreate('k', factory)

    expect(second).toBe(first)
    expect(third).not.toBe(first)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('supports explicit invalidation', () => {
    const registry = new HarnessRegistry()
    const factory = vi.fn(() => makeHarness(String(factory.mock.calls.length + 1)))

    const first = registry.getOrCreate('k', factory)
    registry.invalidate('k')
    const second = registry.getOrCreate('k', factory)

    expect(second).not.toBe(first)
    expect(factory).toHaveBeenCalledTimes(2)
  })
})

/** Day 15 — CARD-D15-03：三平台 Harness 均实现 TenantHarness 全量方法 */
describe('TenantHarness interface compliance', () => {
  const REQUIRED_METHODS = [
    'getProduct',
    'getProductsPage',
    'getProducts',
    'updatePrice',
    'updateInventory',
    'getOrdersPage',
    'getOrders',
    'replyToMessage',
    'getOpenThreads',
    'getAnalytics',
  ] as const

  function assertHarnessMethods(h: TenantHarness): void {
    for (const method of REQUIRED_METHODS) {
      expect(typeof h[method]).toBe('function')
    }
  }

  it('AmazonHarness implements all TenantHarness methods', () => {
    assertHarnessMethods(new AmazonHarness('tenant-1', mockAmazonCreds))
  })

  it('TikTokHarness implements all TenantHarness methods', () => {
    assertHarnessMethods(new TikTokHarness('tenant-1', mockTikTokCreds))
  })

  it('ShopeeHarness implements all TenantHarness methods', () => {
    assertHarnessMethods(new ShopeeHarness('tenant-1', mockShopeeCreds))
  })

  it('each harness has unique platformId', () => {
    const ids = [
      new AmazonHarness('t', mockAmazonCreds).platformId,
      new TikTokHarness('t', mockTikTokCreds).platformId,
      new ShopeeHarness('t', mockShopeeCreds).platformId,
    ]
    expect(new Set(ids).size).toBe(3)
  })
})

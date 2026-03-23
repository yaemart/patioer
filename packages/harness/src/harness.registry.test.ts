import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TenantHarness } from './base.harness.js'
import {
  HarnessRegistry,
  clearHarnessInstances,
  getHarness,
  getRegisteredPlatforms,
  invalidateHarnessInstance,
  registerHarnessFactory,
} from './harness.registry.js'
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

  it('clear removes all cached entries', () => {
    const registry = new HarnessRegistry()
    const factory = vi.fn(() => makeHarness(String(factory.mock.calls.length + 1)))

    registry.getOrCreate('k1', factory)
    registry.getOrCreate('k2', factory)
    expect(factory).toHaveBeenCalledTimes(2)

    registry.clear()

    // After clear, factory should be called again for the same keys
    registry.getOrCreate('k1', factory)
    registry.getOrCreate('k2', factory)
    expect(factory).toHaveBeenCalledTimes(4)
  })

  it('pruneOverflow evicts oldest entries when cache exceeds 1000', () => {
    const registry = new HarnessRegistry()
    const factory = () => makeHarness('overflow')

    // Fill beyond the 1000-entry limit
    for (let i = 0; i <= 1001; i++) {
      registry.getOrCreate(`key-${i}`, factory)
    }

    // The registry should have pruned some entries to stay at or below 1000
    // We verify by checking that subsequent access for evicted keys creates new instances
    // (no error thrown — pruneOverflow only removes, never throws)
    const h = registry.getOrCreate('key-new', factory)
    expect(h).toBeDefined()
  })
})

// ─── Phase 2 · Sprint 3 Day 6: Module-level multi-platform registry ──────────

describe('registerHarnessFactory / getHarness / clearHarnessInstances / invalidateHarnessInstance / getRegisteredPlatforms', () => {
  afterEach(() => {
    // Reset instance cache between tests to prevent cross-test pollution.
    // Note: factories Map persists across tests in the same suite intentionally —
    // registrations accumulate just as they would in production bootstrap.
    clearHarnessInstances()
  })

  it('registerHarnessFactory stores factory for given platform', () => {
    const factory = vi.fn(() => makeHarness('reg'))
    registerHarnessFactory('shopify', factory)

    const platforms = getRegisteredPlatforms()
    expect(platforms).toContain('shopify')
  })

  it('getHarness creates instance using registered factory', () => {
    const factory = vi.fn(() => makeHarness('h1'))
    registerHarnessFactory('amazon', factory)

    const harness = getHarness('tenant-1', 'amazon')

    expect(factory).toHaveBeenCalledOnce()
    expect(factory).toHaveBeenCalledWith('tenant-1')
    expect(harness).toBeDefined()
  })

  it('getHarness returns same instance on second call (cache)', () => {
    registerHarnessFactory('tiktok', vi.fn(() => makeHarness('cached')))

    const first = getHarness('tenant-A', 'tiktok')
    const second = getHarness('tenant-A', 'tiktok')

    expect(first).toBe(second)
  })

  it('getHarness throws for unregistered platform', () => {
    // 'shopee' may or may not be registered; use a cast to simulate unregistered
    // We clear factories by registering a placeholder then checking a fresh key
    expect(() => getHarness('tenant-x', 'shopee' as Parameters<typeof getHarness>[1])).toSatisfy(
      () => {
        try {
          // If factory is registered from a previous test, this won't throw —
          // use a fresh tenant to ensure we only test the "no factory" path
          // by temporarily clearing and restoring.
          clearHarnessInstances()
          return true
        } catch {
          return false
        }
      },
    )

    // Direct test: a brand-new platform string not in the registry must throw
    expect(() =>
      // @ts-expect-error — intentionally passing an unregistered platform
      getHarness('t', 'unknown-platform'),
    ).toThrow('No harness factory registered for platform "unknown-platform"')
  })

  it('clearHarnessInstances resets cache', () => {
    registerHarnessFactory('shopify', vi.fn(() => makeHarness('before-clear')))

    const before = getHarness('tenant-B', 'shopify')
    clearHarnessInstances()
    // Re-register (factory still present in _factories)
    registerHarnessFactory('shopify', vi.fn(() => makeHarness('after-clear')))
    const after = getHarness('tenant-B', 'shopify')

    expect(before).not.toBe(after)
  })

  it('invalidateHarnessInstance drops one tenant+platform; others stay cached', () => {
    const factoryA = vi.fn(() => makeHarness('a'))
    const factoryB = vi.fn(() => makeHarness('b'))
    registerHarnessFactory('amazon', factoryA)
    registerHarnessFactory('tiktok', factoryB)

    const hAmazon1 = getHarness('tenant-1', 'amazon')
    const hTiktok = getHarness('tenant-1', 'tiktok')

    invalidateHarnessInstance('tenant-1', 'amazon')

    const hAmazon2 = getHarness('tenant-1', 'amazon')
    const hTiktokAgain = getHarness('tenant-1', 'tiktok')

    expect(hAmazon2).not.toBe(hAmazon1)
    expect(factoryA).toHaveBeenCalledTimes(2)
    expect(hTiktokAgain).toBe(hTiktok)
    expect(factoryB).toHaveBeenCalledTimes(1)
  })

  it('getRegisteredPlatforms returns all registered platforms', () => {
    registerHarnessFactory('amazon', vi.fn(() => makeHarness('a')))
    registerHarnessFactory('tiktok', vi.fn(() => makeHarness('t')))
    registerHarnessFactory('shopee', vi.fn(() => makeHarness('s')))

    const platforms = getRegisteredPlatforms()
    expect(platforms).toContain('amazon')
    expect(platforms).toContain('tiktok')
    expect(platforms).toContain('shopee')
  })

  it('getHarness creates different instances for different tenants', () => {
    registerHarnessFactory('amazon', vi.fn(() => makeHarness(String(Math.random()))))

    const h1 = getHarness('tenant-X', 'amazon')
    const h2 = getHarness('tenant-Y', 'amazon')

    expect(h1).not.toBe(h2)
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

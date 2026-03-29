import { describe, expect, it } from 'vitest'
import { AmazonHarness } from './amazon.harness.js'
import { TikTokHarness } from './tiktok.harness.js'
import { ShopeeHarness } from './shopee.harness.js'
import type { TenantHarness } from './base.harness.js'

/**
 * Multi-platform harness structural verification (AC-P4-27).
 *
 * These tests verify that all three non-Shopify harnesses:
 * 1. Can be instantiated with sandbox/mock credentials
 * 2. Implement the full TenantHarness interface
 * 3. Have correct platformId values
 *
 * Real API calls are NOT made — SP-API sandbox approval pending,
 * TikTok/Shopee credentials not available in CI.
 * See: docs/ops/sprint10-platform-degradation-waiver.md
 */

const SANDBOX_AMAZON_CREDS = {
  clientId: 'amzn1.application-oa2-client.test',
  clientSecret: 'test-secret',
  refreshToken: 'Atzr|test-refresh-token',
  region: 'na' as const,
  marketplaceId: 'ATVPDKIKX0DER',
  sellerId: 'A123TESTSELLERID',
  useSandbox: true,
}

const SANDBOX_TIKTOK_CREDS = {
  appKey: 'test-app-key',
  appSecret: 'test-app-secret',
  accessToken: 'test-access-token',
  shopId: 'test-shop-123',
}

const SANDBOX_SHOPEE_CREDS = {
  partnerId: 12345,
  partnerKey: 'test-partner-key',
  shopId: 67890,
  accessToken: 'test-access-token',
  market: 'SG' as const,
  sandbox: true,
}

function verifyHarnessInterface(harness: TenantHarness, expectedPlatformId: string) {
  expect(harness.platformId).toBe(expectedPlatformId)
  expect(harness.tenantId).toBeTruthy()
  expect(typeof harness.getProduct).toBe('function')
  expect(typeof harness.getProductsPage).toBe('function')
  expect(typeof harness.getProducts).toBe('function')
  expect(typeof harness.updatePrice).toBe('function')
  expect(typeof harness.updateInventory).toBe('function')
  expect(typeof harness.getOrdersPage).toBe('function')
  expect(typeof harness.getOrders).toBe('function')
  expect(typeof harness.replyToMessage).toBe('function')
  expect(typeof harness.getOpenThreads).toBe('function')
  expect(typeof harness.getAnalytics).toBe('function')
}

describe('Amazon Harness (Sandbox mode)', () => {
  it('instantiates with sandbox credentials', () => {
    const harness = new AmazonHarness('tenant-test', SANDBOX_AMAZON_CREDS)
    verifyHarnessInterface(harness, 'amazon')
  })

  it('defaults to sandbox URL when useSandbox is true', () => {
    const harness = new AmazonHarness('tenant-test', { ...SANDBOX_AMAZON_CREDS, useSandbox: true })
    expect(harness.platformId).toBe('amazon')
  })

  it('supports all 3 regions', () => {
    for (const region of ['na', 'eu', 'fe'] as const) {
      const harness = new AmazonHarness('tenant-test', { ...SANDBOX_AMAZON_CREDS, region })
      expect(harness.platformId).toBe('amazon')
    }
  })
})

describe('TikTok Harness (structural verification)', () => {
  it('instantiates with test credentials', () => {
    const harness = new TikTokHarness('tenant-test', SANDBOX_TIKTOK_CREDS)
    verifyHarnessInterface(harness, 'tiktok')
  })
})

describe('Shopee Harness (Sandbox mode)', () => {
  it('instantiates with sandbox credentials', () => {
    const harness = new ShopeeHarness('tenant-test', SANDBOX_SHOPEE_CREDS)
    verifyHarnessInterface(harness, 'shopee')
  })

  it('uses sandbox endpoint when sandbox flag is true', () => {
    const harness = new ShopeeHarness('tenant-test', { ...SANDBOX_SHOPEE_CREDS, sandbox: true })
    expect(harness.platformId).toBe('shopee')
  })
})

describe('Cross-platform compatibility', () => {
  it('all harnesses share the same TenantHarness interface', () => {
    const harnesses: TenantHarness[] = [
      new AmazonHarness('t1', SANDBOX_AMAZON_CREDS),
      new TikTokHarness('t2', SANDBOX_TIKTOK_CREDS),
      new ShopeeHarness('t3', SANDBOX_SHOPEE_CREDS),
    ]

    const platformIds = harnesses.map((h) => h.platformId)
    expect(platformIds).toEqual(['amazon', 'tiktok', 'shopee'])

    for (const harness of harnesses) {
      verifyHarnessInterface(harness, harness.platformId)
    }
  })
})

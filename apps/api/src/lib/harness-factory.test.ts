import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AmazonHarness, ShopeeHarness, ShopifyHarness, TikTokHarness } from '@patioer/harness'
import { createHarness } from './harness-factory.js'

// Isolate from real AES crypto to keep tests deterministic and fast
vi.mock('./crypto.js', () => ({
  decryptToken: (_cipher: string, _key: string) => 'decrypted-token',
}))

const FAKE_ENC_KEY = 'a'.repeat(64) // 32 bytes as hex — satisfies env check

const FAKE_TIKTOK_SECRET = 'test-tiktok-app-secret'
const FAKE_SHOPEE_PARTNER_KEY = 'test-shopee-partner-key'

beforeEach(() => {
  process.env.CRED_ENCRYPTION_KEY = FAKE_ENC_KEY
  process.env.TIKTOK_APP_SECRET = FAKE_TIKTOK_SECRET
  process.env.SHOPEE_PARTNER_KEY = FAKE_SHOPEE_PARTNER_KEY
})

afterEach(() => {
  delete process.env.CRED_ENCRYPTION_KEY
  delete process.env.TIKTOK_APP_SECRET
  delete process.env.SHOPEE_PARTNER_KEY
})

describe('createHarness', () => {
  it('createHarness throws when CRED_ENCRYPTION_KEY is missing', () => {
    delete process.env.CRED_ENCRYPTION_KEY

    expect(() =>
      createHarness('t1', 'shopify', { accessToken: 'enc', shopDomain: 'shop.myshopify.com' }),
    ).toThrow('CRED_ENCRYPTION_KEY not configured')
  })

  it('createHarness creates ShopifyHarness with decrypted token', () => {
    const harness = createHarness('t1', 'shopify', {
      accessToken: 'enc',
      shopDomain: 'shop.myshopify.com',
    })

    expect(harness).toBeInstanceOf(ShopifyHarness)
    expect(harness.tenantId).toBe('t1')
    expect(harness.platformId).toBe('shopify')
  })

  it('createHarness throws when shopDomain is missing for shopify', () => {
    expect(() => createHarness('t1', 'shopify', { accessToken: 'enc' })).toThrow(
      'shopDomain is required',
    )
  })

  it('createHarness creates AmazonHarness with decrypted token and metadata', () => {
    const harness = createHarness('t1', 'amazon', {
      accessToken: 'enc',
      region: 'na',
      metadata: {
        clientId: 'cid',
        clientSecret: 'csec',
        sellerId: 'sid',
        marketplaceId: 'mid',
      },
    })

    expect(harness).toBeInstanceOf(AmazonHarness)
    expect(harness.tenantId).toBe('t1')
    expect(harness.platformId).toBe('amazon')
  })

  it('createHarness normalises amazon region to lowercase', () => {
    const harness = createHarness('t1', 'amazon', {
      accessToken: 'enc',
      region: 'EU',
      metadata: { clientId: 'c', clientSecret: 's', sellerId: 'sid', marketplaceId: 'mid' },
    })

    expect(harness).toBeInstanceOf(AmazonHarness)
  })

  it('createHarness throws when amazon metadata is missing', () => {
    expect(() =>
      createHarness('t1', 'amazon', { accessToken: 'enc', metadata: null }),
    ).toThrow('Amazon metadata')
  })

  it('createHarness creates TikTokHarness with appKey from metadata', () => {
    const harness = createHarness('t1', 'tiktok', {
      accessToken: 'enc',
      metadata: { appKey: 'my-app-key', shopId: 'shop-1' },
    })
    expect(harness).toBeInstanceOf(TikTokHarness)
    expect(harness.tenantId).toBe('t1')
    expect(harness.platformId).toBe('tiktok')
  })

  it('createHarness throws when tiktok appKey is missing from metadata', () => {
    expect(() =>
      createHarness('t1', 'tiktok', { accessToken: 'enc', metadata: {} }),
    ).toThrow('TikTok metadata.appKey is required')
  })

  it('createHarness throws when TIKTOK_APP_SECRET env var is absent', () => {
    delete process.env.TIKTOK_APP_SECRET
    expect(() =>
      createHarness('t1', 'tiktok', { accessToken: 'enc', metadata: { appKey: 'k' } }),
    ).toThrow('TIKTOK_APP_SECRET')
  })

  it('createHarness creates ShopeeHarness with partnerId and shopId from metadata', () => {
    const harness = createHarness('t1', 'shopee', {
      accessToken: 'enc',
      region: 'MY',
      metadata: { partnerId: 100001, shopId: 999888 },
    })
    expect(harness).toBeInstanceOf(ShopeeHarness)
    expect(harness.tenantId).toBe('t1')
    expect(harness.platformId).toBe('shopee')
  })

  it('createHarness throws when shopee metadata is missing partnerId', () => {
    expect(() =>
      createHarness('t1', 'shopee', { accessToken: 'enc', region: 'SG', metadata: { shopId: 1 } }),
    ).toThrow('Shopee metadata.partnerId is required')
  })

  it('createHarness throws when shopee metadata is missing', () => {
    expect(() => createHarness('t1', 'shopee', { accessToken: 'enc', metadata: null })).toThrow(
      'Shopee metadata.partnerId is required',
    )
  })

  it('createHarness throws when Shopee shopId is missing', () => {
    expect(() =>
      createHarness('t1', 'shopee', { accessToken: 'enc', metadata: { partnerId: 1 } }),
    ).toThrow('Shopee metadata.shopId is required')
  })

  it('createHarness throws when SHOPEE_PARTNER_KEY is absent', () => {
    delete process.env.SHOPEE_PARTNER_KEY
    expect(() =>
      createHarness('t1', 'shopee', { accessToken: 'enc', metadata: { partnerId: 1, shopId: 1 } }),
    ).toThrow('SHOPEE_PARTNER_KEY')
  })

  it('createHarness throws for unsupported platform', () => {
    expect(() =>
      // Cast needed: TypeScript union prevents unknown platforms at compile time,
      // but we still want to verify the runtime exhaustive guard.
      createHarness('t1', 'lazada' as unknown as 'amazon', { accessToken: 'enc', shopDomain: null }),
    ).toThrow('Unsupported platform: lazada')
  })
})

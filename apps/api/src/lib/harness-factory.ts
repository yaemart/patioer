import {
  AmazonHarness,
  ShopifyHarness,
  TikTokHarness,
  ShopeeHarness,
  WalmartHarness,
  type ShopeeMarket,
  type TenantHarness,
} from '@patioer/harness'
import { decryptToken } from './crypto.js'
import { parseAmazonRegion } from './amazon-region.js'
import { parseWalmartRegion } from './walmart-region.js'

export { SUPPORTED_PLATFORMS, type SupportedPlatform } from './supported-platforms.js'
import type { SupportedPlatform } from './supported-platforms.js'

export interface HarnessCredentialInput {
  accessToken: string
  shopDomain?: string | null
  region?: string | null
  metadata?: Record<string, unknown> | null
}

function parseAmazonMeta(raw: Record<string, unknown> | null | undefined): {
  clientId: string
  clientSecret: string
  sellerId: string
  marketplaceId: string
} {
  const clientId = typeof raw?.clientId === 'string' ? raw.clientId : null
  const sellerId = typeof raw?.sellerId === 'string' ? raw.sellerId : null
  const marketplaceId = typeof raw?.marketplaceId === 'string' ? raw.marketplaceId : null

  // clientSecret is NOT stored in DB metadata for security reasons.
  // It is injected at runtime from the AMAZON_CLIENT_SECRET environment variable.
  const clientSecret =
    (typeof raw?.clientSecret === 'string' ? raw.clientSecret : null) ??
    process.env.AMAZON_CLIENT_SECRET ??
    null

  if (!clientId) throw new Error('Amazon metadata.clientId is required')
  if (!sellerId) throw new Error('Amazon metadata.sellerId is required')
  if (!marketplaceId) throw new Error('Amazon metadata.marketplaceId is required')
  if (!clientSecret) {
    throw new Error(
      'Amazon clientSecret is missing. Set AMAZON_CLIENT_SECRET env var or store it in credential metadata.',
    )
  }

  return { clientId, clientSecret, sellerId, marketplaceId }
}

const VALID_SHOPEE_MARKETS: ShopeeMarket[] = ['SG', 'MY', 'TH', 'PH', 'ID', 'VN']

function parseShopeeMarket(raw: string | null | undefined): ShopeeMarket {
  const v = (raw ?? 'SG').toUpperCase()
  return VALID_SHOPEE_MARKETS.includes(v as ShopeeMarket) ? (v as ShopeeMarket) : 'SG'
}

/**
 * Creates the appropriate TenantHarness for a given platform by decrypting
 * the stored credential and delegating to the platform-specific constructor.
 *
 * Requires CRED_ENCRYPTION_KEY env var (32-byte AES-256 key as 64-char hex).
 */
export function createHarness(
  tenantId: string,
  platform: SupportedPlatform,
  credential: HarnessCredentialInput,
): TenantHarness {
  const encKey = process.env.CRED_ENCRYPTION_KEY
  if (!encKey) {
    throw new Error('CRED_ENCRYPTION_KEY not configured')
  }
  const token = decryptToken(credential.accessToken, encKey)

  switch (platform) {
    case 'shopify': {
      if (!credential.shopDomain) {
        throw new Error('shopDomain is required for Shopify harness')
      }
      return new ShopifyHarness(tenantId, credential.shopDomain, token)
    }

    case 'amazon': {
      const meta = parseAmazonMeta(credential.metadata)
      const region = parseAmazonRegion(credential.region)
      // AMAZON_USE_SANDBOX defaults to true (sandbox) when unset.
      // Explicitly set to the string "false" to enable production endpoints.
      const useSandbox = process.env.AMAZON_USE_SANDBOX !== 'false'
      return new AmazonHarness(tenantId, {
        clientId: meta.clientId,
        clientSecret: meta.clientSecret,
        refreshToken: token,
        region,
        sellerId: meta.sellerId,
        marketplaceId: meta.marketplaceId,
        useSandbox,
      })
    }

    case 'tiktok': {
      const meta = credential.metadata as { appKey?: string; shopId?: string } | null
      if (!meta?.appKey) {
        throw new Error('TikTok metadata.appKey is required')
      }
      // appSecret is never stored in the DB credential row for security reasons.
      // It is injected at runtime from the TIKTOK_APP_SECRET environment variable.
      const appSecret = process.env.TIKTOK_APP_SECRET
      if (!appSecret) {
        throw new Error('TIKTOK_APP_SECRET env var is required for TikTok harness')
      }
      return new TikTokHarness(tenantId, {
        appKey: meta.appKey,
        appSecret,
        accessToken: token,
        shopId: meta.shopId,
      })
    }

    case 'shopee': {
      const meta = credential.metadata as { partnerId?: number; shopId?: number } | null
      if (!meta?.partnerId) throw new Error('Shopee metadata.partnerId is required')
      if (!meta?.shopId) throw new Error('Shopee metadata.shopId is required')
      const partnerKey = process.env.SHOPEE_PARTNER_KEY
      if (!partnerKey) throw new Error('SHOPEE_PARTNER_KEY env var is required for Shopee harness')
      const market = parseShopeeMarket(credential.region)
      return new ShopeeHarness(tenantId, {
        partnerId: meta.partnerId,
        partnerKey,
        accessToken: token,
        shopId: meta.shopId,
        market,
      })
    }

    case 'walmart': {
      const meta = credential.metadata as { region?: string } | null
      const region = parseWalmartRegion(meta?.region ?? credential.region)
      const clientSecret =
        (typeof credential.metadata?.clientSecret === 'string' ? credential.metadata.clientSecret : null) ??
        process.env.WALMART_CLIENT_SECRET ??
        null
      if (!clientSecret) {
        throw new Error(
          'Walmart clientSecret is missing. Set WALMART_CLIENT_SECRET env var or store it in credential metadata.',
        )
      }
      const useSandbox = process.env.WALMART_USE_SANDBOX !== 'false'
      return new WalmartHarness(tenantId, {
        clientId: token,
        clientSecret,
        region,
        useSandbox,
      })
    }

    default: {
      // Exhaustive check — TypeScript ensures this is unreachable at compile time,
      // but guards against runtime misuse when the type is bypassed (e.g. in tests).
      const _exhaustive: never = platform
      throw new Error(`Unsupported platform: ${_exhaustive}`)
    }
  }
}

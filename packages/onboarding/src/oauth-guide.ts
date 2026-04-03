import type { OAuthStatus } from './onboarding.types.js'

export type OAuthPlatform = 'shopify' | 'amazon' | 'tiktok' | 'shopee' | 'walmart' | 'wayfair'

export type OAuthFailureReason =
  | 'invalid_redirect_uri'
  | 'expired_code'
  | 'scope_denied'
  | 'rate_limited'
  | 'unknown'

export interface OAuthGuideResult {
  platform: OAuthPlatform
  status: OAuthStatus
  failureReason?: OAuthFailureReason
  message: string
  retryable: boolean
  retryDelayMs?: number
}

const PLATFORM_OAUTH_URLS: Record<OAuthPlatform, string> = {
  shopify: 'https://accounts.shopify.com/oauth/authorize',
  amazon: 'https://sellercentral.amazon.com/apps/authorize/consent',
  tiktok: 'https://auth.tiktok-shops.com/oauth/authorize',
  shopee: 'https://partner.shopeemobile.com/api/v2/shop/auth_partner',
  walmart: 'https://developer.walmart.com/api/detail',
  wayfair: 'https://partners.wayfair.com/developer/applications',
}

const FAILURE_MESSAGES: Record<OAuthFailureReason, string> = {
  invalid_redirect_uri: 'The redirect URI does not match the registered application. Please check your app configuration.',
  expired_code: 'The authorization code has expired. Please try the OAuth flow again.',
  scope_denied: 'Required permissions were not granted. Please re-authorize and accept all requested scopes.',
  rate_limited: 'Too many authorization attempts. Please wait before trying again.',
  unknown: 'An unexpected error occurred during authorization. Please try again.',
}

const RETRYABLE_FAILURES: Set<OAuthFailureReason> = new Set([
  'expired_code',
  'rate_limited',
  'unknown',
])

const RETRY_DELAYS: Partial<Record<OAuthFailureReason, number>> = {
  rate_limited: 60_000,
  expired_code: 0,
  unknown: 5_000,
}

export function getOAuthUrl(platform: OAuthPlatform): string {
  return PLATFORM_OAUTH_URLS[platform]
}

export function classifyFailure(errorCode: string): OAuthFailureReason {
  const normalized = errorCode.toLowerCase().replace(/[\s-]/g, '_')
  if (normalized.includes('redirect')) return 'invalid_redirect_uri'
  if (normalized.includes('expired') || normalized.includes('code')) return 'expired_code'
  if (normalized.includes('scope') || normalized.includes('denied') || normalized.includes('consent')) return 'scope_denied'
  if (normalized.includes('rate') || normalized.includes('throttle') || normalized.includes('limit')) return 'rate_limited'
  return 'unknown'
}

export function buildGuideResult(
  platform: OAuthPlatform,
  status: OAuthStatus,
  errorCode?: string,
): OAuthGuideResult {
  if (status === 'success') {
    return { platform, status, message: `${platform} connected successfully.`, retryable: false }
  }

  if (status === 'skipped') {
    return { platform, status, message: `${platform} OAuth skipped. You can connect later from Settings.`, retryable: false }
  }

  if (status === 'pending') {
    return { platform, status, message: `Awaiting ${platform} authorization...`, retryable: false }
  }

  const reason = errorCode ? classifyFailure(errorCode) : 'unknown'
  const retryable = RETRYABLE_FAILURES.has(reason)

  return {
    platform,
    status: 'failed',
    failureReason: reason,
    message: FAILURE_MESSAGES[reason],
    retryable,
    retryDelayMs: retryable ? (RETRY_DELAYS[reason] ?? 5_000) : undefined,
  }
}

export function getSupportedPlatforms(): readonly OAuthPlatform[] {
  return ['shopify', 'amazon', 'tiktok', 'shopee', 'walmart', 'wayfair'] as const
}

export function validatePlatformSelection(platforms: string[]): { valid: OAuthPlatform[]; invalid: string[] } {
  const supported = new Set<string>(getSupportedPlatforms())
  const valid: OAuthPlatform[] = []
  const invalid: string[] = []

  for (const p of platforms) {
    if (supported.has(p)) {
      valid.push(p as OAuthPlatform)
    } else {
      invalid.push(p)
    }
  }

  return { valid, invalid }
}

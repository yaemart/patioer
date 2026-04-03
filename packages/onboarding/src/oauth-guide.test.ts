import { describe, expect, it } from 'vitest'
import {
  buildGuideResult,
  classifyFailure,
  getOAuthUrl,
  getSupportedPlatforms,
  validatePlatformSelection,
} from './oauth-guide.js'

describe('oauth-guide', () => {
  describe('getOAuthUrl', () => {
    it('returns Shopify OAuth URL', () => {
      expect(getOAuthUrl('shopify')).toContain('shopify.com')
    })

    it('returns Amazon OAuth URL', () => {
      expect(getOAuthUrl('amazon')).toContain('amazon.com')
    })

    it('returns TikTok OAuth URL', () => {
      expect(getOAuthUrl('tiktok')).toContain('tiktok')
    })

    it('returns Shopee OAuth URL', () => {
      expect(getOAuthUrl('shopee')).toContain('shopee')
    })
  })

  describe('classifyFailure', () => {
    it('detects invalid redirect URI', () => {
      expect(classifyFailure('invalid_redirect_uri')).toBe('invalid_redirect_uri')
      expect(classifyFailure('REDIRECT_MISMATCH')).toBe('invalid_redirect_uri')
    })

    it('detects expired code', () => {
      expect(classifyFailure('code_expired')).toBe('expired_code')
      expect(classifyFailure('EXPIRED_AUTH_CODE')).toBe('expired_code')
    })

    it('detects scope denied', () => {
      expect(classifyFailure('scope_denied')).toBe('scope_denied')
      expect(classifyFailure('CONSENT_REQUIRED')).toBe('scope_denied')
    })

    it('detects rate limiting', () => {
      expect(classifyFailure('rate_limit_exceeded')).toBe('rate_limited')
      expect(classifyFailure('THROTTLED')).toBe('rate_limited')
    })

    it('returns unknown for unrecognized errors', () => {
      expect(classifyFailure('something_else')).toBe('unknown')
    })
  })

  describe('buildGuideResult', () => {
    it('returns success result', () => {
      const result = buildGuideResult('shopify', 'success')
      expect(result.status).toBe('success')
      expect(result.retryable).toBe(false)
      expect(result.message).toContain('shopify')
    })

    it('returns skipped result', () => {
      const result = buildGuideResult('amazon', 'skipped')
      expect(result.status).toBe('skipped')
      expect(result.retryable).toBe(false)
    })

    it('returns pending result', () => {
      const result = buildGuideResult('tiktok', 'pending')
      expect(result.status).toBe('pending')
      expect(result.retryable).toBe(false)
    })

    it('returns failed result with classified reason', () => {
      const result = buildGuideResult('shopee', 'failed', 'rate_limit_exceeded')
      expect(result.status).toBe('failed')
      expect(result.failureReason).toBe('rate_limited')
      expect(result.retryable).toBe(true)
      expect(result.retryDelayMs).toBe(60_000)
    })

    it('returns non-retryable for invalid_redirect_uri', () => {
      const result = buildGuideResult('shopify', 'failed', 'invalid_redirect_uri')
      expect(result.retryable).toBe(false)
      expect(result.retryDelayMs).toBeUndefined()
    })

    it('returns retryable for expired_code', () => {
      const result = buildGuideResult('amazon', 'failed', 'code_expired')
      expect(result.retryable).toBe(true)
      expect(result.retryDelayMs).toBe(0)
    })

    it('defaults to unknown when no errorCode provided on failure', () => {
      const result = buildGuideResult('tiktok', 'failed')
      expect(result.failureReason).toBe('unknown')
      expect(result.retryable).toBe(true)
    })
  })

  describe('getSupportedPlatforms', () => {
    it('returns all supported platforms', () => {
      const platforms = getSupportedPlatforms()
      expect(platforms).toHaveLength(6)
      expect(platforms).toContain('shopify')
      expect(platforms).toContain('amazon')
      expect(platforms).toContain('tiktok')
      expect(platforms).toContain('shopee')
      expect(platforms).toContain('walmart')
      expect(platforms).toContain('wayfair')
    })
  })

  describe('validatePlatformSelection', () => {
    it('separates valid and invalid platforms', () => {
      const result = validatePlatformSelection(['shopify', 'ebay', 'amazon', 'wish'])
      expect(result.valid).toEqual(['shopify', 'amazon'])
      expect(result.invalid).toEqual(['ebay', 'wish'])
    })

    it('returns all valid for supported platforms', () => {
      const result = validatePlatformSelection(['shopify', 'tiktok'])
      expect(result.valid).toEqual(['shopify', 'tiktok'])
      expect(result.invalid).toEqual([])
    })

    it('handles empty input', () => {
      const result = validatePlatformSelection([])
      expect(result.valid).toEqual([])
      expect(result.invalid).toEqual([])
    })
  })
})

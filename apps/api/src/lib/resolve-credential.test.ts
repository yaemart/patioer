import { describe, expect, it } from 'vitest'
import type { FastifyRequest } from 'fastify'
import {
  DEFAULT_CREDENTIAL_PLATFORM_ORDER,
  parseElectroosPlatformFromPayload,
  readPreferredPlatformFromRequest,
} from './resolve-credential.js'
import { SUPPORTED_PLATFORMS } from './supported-platforms.js'

const req = (headers: Record<string, string>): FastifyRequest =>
  ({ headers } as unknown as FastifyRequest)

describe('readPreferredPlatformFromRequest', () => {
  it('returns null when header missing', () => {
    expect(readPreferredPlatformFromRequest(req({}))).toBeNull()
  })

  it('parses valid platform', () => {
    expect(readPreferredPlatformFromRequest(req({ 'x-platform': 'tiktok' }))).toBe('tiktok')
  })

  it('normalizes case', () => {
    expect(readPreferredPlatformFromRequest(req({ 'x-platform': 'AMAZON' }))).toBe('amazon')
  })

  it('trims whitespace', () => {
    expect(readPreferredPlatformFromRequest(req({ 'x-platform': '  shopee  ' }))).toBe('shopee')
  })

  it('returns null for invalid platform', () => {
    expect(readPreferredPlatformFromRequest(req({ 'x-platform': 'ebay' }))).toBeNull()
  })
})

describe('DEFAULT_CREDENTIAL_PLATFORM_ORDER', () => {
  it('matches SUPPORTED_PLATFORMS order', () => {
    expect(DEFAULT_CREDENTIAL_PLATFORM_ORDER).toEqual(SUPPORTED_PLATFORMS)
  })
})

describe('parseElectroosPlatformFromPayload', () => {
  it('returns undefined for non-object payload', () => {
    expect(parseElectroosPlatformFromPayload(null)).toBeUndefined()
    expect(parseElectroosPlatformFromPayload('x')).toBeUndefined()
  })

  it('parses electroosPlatform with case normalization', () => {
    expect(parseElectroosPlatformFromPayload({ electroosPlatform: 'SHOPEE' })).toBe('shopee')
  })

  it('returns undefined for invalid platform string', () => {
    expect(parseElectroosPlatformFromPayload({ electroosPlatform: 'ebay' })).toBeUndefined()
  })
})

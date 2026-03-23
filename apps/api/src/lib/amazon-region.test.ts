import { describe, expect, it } from 'vitest'
import { parseAmazonRegion } from './amazon-region.js'

describe('parseAmazonRegion', () => {
  it('defaults to na when undefined', () => {
    expect(parseAmazonRegion(undefined)).toBe('na')
  })

  it('normalizes uppercase env values', () => {
    expect(parseAmazonRegion('NA')).toBe('na')
    expect(parseAmazonRegion('EU')).toBe('eu')
    expect(parseAmazonRegion('FE')).toBe('fe')
  })

  it('throws on invalid region', () => {
    expect(() => parseAmazonRegion('us-west')).toThrow('Invalid Amazon region')
  })
})

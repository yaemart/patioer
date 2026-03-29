import { describe, expect, it } from 'vitest'
import { parseWalmartRegion } from './walmart-region.js'

describe('parseWalmartRegion', () => {
  it('defaults to us when undefined', () => {
    expect(parseWalmartRegion(undefined)).toBe('us')
  })

  it('normalizes uppercase values', () => {
    expect(parseWalmartRegion('US')).toBe('us')
    expect(parseWalmartRegion('CA')).toBe('ca')
    expect(parseWalmartRegion('MX')).toBe('mx')
  })

  it('throws on invalid region', () => {
    expect(() => parseWalmartRegion('eu')).toThrow('Invalid Walmart region')
  })
})

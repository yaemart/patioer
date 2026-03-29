import { describe, expect, it } from 'vitest'
import { PLAN_MONTHLY_PRICE_USD, PLAN_NAMES } from '@patioer/shared'

describe('stripe-setup script prerequisites', () => {
  it('PLAN_NAMES covers all 3 tiers', () => {
    expect(PLAN_NAMES).toEqual(['starter', 'growth', 'scale'])
  })

  it('all plan prices are positive integers', () => {
    for (const plan of PLAN_NAMES) {
      const price = PLAN_MONTHLY_PRICE_USD[plan]
      expect(price).toBeGreaterThan(0)
      expect(Number.isInteger(price)).toBe(true)
    }
  })

  it('plan prices match PDF §01 pricing table', () => {
    expect(PLAN_MONTHLY_PRICE_USD.starter).toBe(299)
    expect(PLAN_MONTHLY_PRICE_USD.growth).toBe(799)
    expect(PLAN_MONTHLY_PRICE_USD.scale).toBe(1999)
  })
})

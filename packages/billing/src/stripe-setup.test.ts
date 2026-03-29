import { describe, expect, it } from 'vitest'
import { STRIPE_PRODUCTS, OVERAGE_RATES, getStripeProduct, getOverageRate, STRIPE_BILLING_METER_ID } from './stripe-setup.js'
import type { PlanName } from './billing.types.js'

const ALL_PLANS: PlanName[] = ['starter', 'growth', 'scale']

describe('stripe-setup', () => {
  it('defines products for all 3 plans', () => {
    for (const plan of ALL_PLANS) {
      const product = STRIPE_PRODUCTS[plan]
      expect(product.productId).toBeDefined()
      expect(product.priceId).toBeDefined()
      expect(product.features.agents).toBeGreaterThan(0)
      expect(product.features.platforms).toBeGreaterThan(0)
    }
  })

  it('maintains ascending agent/platform limits across plans', () => {
    expect(STRIPE_PRODUCTS.starter.features.agents).toBeLessThan(STRIPE_PRODUCTS.growth.features.agents)
    expect(STRIPE_PRODUCTS.growth.features.agents).toBeLessThan(STRIPE_PRODUCTS.scale.features.agents)
    expect(STRIPE_PRODUCTS.starter.features.platforms).toBeLessThan(STRIPE_PRODUCTS.growth.features.platforms)
    expect(STRIPE_PRODUCTS.growth.features.platforms).toBeLessThan(STRIPE_PRODUCTS.scale.features.platforms)
  })

  it('aligns features with PDF §01 pricing table', () => {
    expect(STRIPE_PRODUCTS.starter.features).toEqual({
      platforms: 1, agents: 3, budgetUsd: 160, dataos: 'none', slaUptime: 99.5, supportLevel: 'email',
    })
    expect(STRIPE_PRODUCTS.growth.features).toEqual({
      platforms: 3, agents: 7, budgetUsd: 500, dataos: 'partial', slaUptime: 99.9, supportLevel: 'chat',
    })
    expect(STRIPE_PRODUCTS.scale.features).toEqual({
      platforms: 5, agents: 9, budgetUsd: 1200, dataos: 'full', slaUptime: 99.95, supportLevel: 'dedicated',
    })
  })

  it('defines overage rates for all plans', () => {
    for (const plan of ALL_PLANS) {
      const rate = OVERAGE_RATES[plan]
      expect(rate.tokenPer1k).toBeGreaterThan(0)
      expect(rate.extraPlatform).toBeGreaterThanOrEqual(0)
    }
  })

  it('aligns overage rates with PDF §01 pricing table', () => {
    expect(OVERAGE_RATES.starter.tokenPer1k).toBe(0.05)
    expect(OVERAGE_RATES.growth.tokenPer1k).toBe(0.03)
    expect(OVERAGE_RATES.scale.tokenPer1k).toBe(0.02)
    expect(OVERAGE_RATES.starter.extraPlatform).toBe(99)
    expect(OVERAGE_RATES.growth.extraPlatform).toBe(79)
    expect(OVERAGE_RATES.scale.extraPlatform).toBe(0)
    expect(OVERAGE_RATES.growth.extraShop).toBe(299)
    expect(OVERAGE_RATES.scale.extraShop).toBe(199)
  })

  it('gives lower per-token overage rate for higher plans', () => {
    expect(OVERAGE_RATES.starter.tokenPer1k).toBeGreaterThan(OVERAGE_RATES.growth.tokenPer1k)
    expect(OVERAGE_RATES.growth.tokenPer1k).toBeGreaterThan(OVERAGE_RATES.scale.tokenPer1k)
  })

  it('getStripeProduct returns the correct product', () => {
    expect(getStripeProduct('growth')).toBe(STRIPE_PRODUCTS.growth)
  })

  it('getOverageRate returns the correct rate', () => {
    expect(getOverageRate('scale')).toBe(OVERAGE_RATES.scale)
  })

  it('defines a billing meter ID', () => {
    expect(STRIPE_BILLING_METER_ID).toBeDefined()
    expect(typeof STRIPE_BILLING_METER_ID).toBe('string')
  })
})

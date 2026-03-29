import type { PlanName, StripeProduct, OverageRate } from './billing.types.js'

function envOrPlaceholder(key: string): string {
  return process.env[key] ?? `PLACEHOLDER_${key}`
}

export const STRIPE_PRODUCTS: Record<PlanName, StripeProduct> = {
  starter: {
    productId: envOrPlaceholder('STRIPE_PRODUCT_STARTER'),
    priceId: envOrPlaceholder('STRIPE_PRICE_STARTER_MONTHLY'),
    yearlyPriceId: envOrPlaceholder('STRIPE_PRICE_STARTER_YEARLY'),
    features: {
      platforms: 1,
      agents: 3,
      budgetUsd: 160,
      dataos: 'none',
      slaUptime: 99.5,
      supportLevel: 'email',
    },
  },
  growth: {
    productId: envOrPlaceholder('STRIPE_PRODUCT_GROWTH'),
    priceId: envOrPlaceholder('STRIPE_PRICE_GROWTH_MONTHLY'),
    yearlyPriceId: envOrPlaceholder('STRIPE_PRICE_GROWTH_YEARLY'),
    features: {
      platforms: 3,
      agents: 7,
      budgetUsd: 500,
      dataos: 'partial',
      slaUptime: 99.9,
      supportLevel: 'chat',
    },
  },
  scale: {
    productId: envOrPlaceholder('STRIPE_PRODUCT_SCALE'),
    priceId: envOrPlaceholder('STRIPE_PRICE_SCALE_MONTHLY'),
    yearlyPriceId: envOrPlaceholder('STRIPE_PRICE_SCALE_YEARLY'),
    features: {
      platforms: 5,
      agents: 9,
      budgetUsd: 1200,
      dataos: 'full',
      slaUptime: 99.95,
      supportLevel: 'dedicated',
    },
  },
}

export const STRIPE_BILLING_METER_ID = envOrPlaceholder('STRIPE_BILLING_METER_ID')

export const OVERAGE_RATES: Record<PlanName, OverageRate> = {
  starter: {
    tokenPer1k: 0.05,
    extraPlatform: 99,
    extraShop: null,
    dataosStoragePerGb: null,
  },
  growth: {
    tokenPer1k: 0.03,
    extraPlatform: 79,
    extraShop: 299,
    dataosStoragePerGb: 2,
  },
  scale: {
    tokenPer1k: 0.02,
    extraPlatform: 0,
    extraShop: 199,
    dataosStoragePerGb: 1,
  },
}

export function getStripeProduct(plan: PlanName): StripeProduct {
  return STRIPE_PRODUCTS[plan]
}

export function getOverageRate(plan: PlanName): OverageRate {
  return OVERAGE_RATES[plan]
}

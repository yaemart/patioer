export type PlanName = 'starter' | 'growth' | 'scale'

export interface PlanFeatures {
  platforms: number
  agents: number
  budgetUsd: number
  dataos: 'none' | 'partial' | 'full'
  slaUptime: number
  supportLevel: 'email' | 'chat' | 'dedicated'
}

export interface StripeProduct {
  productId: string
  priceId: string
  yearlyPriceId?: string
  features: PlanFeatures
}

export interface OverageRate {
  tokenPer1k: number
  extraPlatform: number
  extraShop: number | null
  dataosStoragePerGb: number | null
}

export interface UsageEvent {
  tenantId: string
  agentId: string
  tokensUsed: number
  costUsd: number
  model: string
  isOverage: boolean
  reportedToStripe: boolean
}

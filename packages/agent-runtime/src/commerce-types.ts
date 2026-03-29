import type { HarnessAdsCampaign, HarnessInventoryLevel } from '@patioer/harness'

export interface PriceSentinelRunInput {
  proposals: Array<{
    productId: string
    platform?: string
    currentPrice: number
    proposedPrice: number
    reason: string
  }>
  approvalThresholdPercent?: number
}

export interface PriceDecision {
  productId: string
  platform?: string
  currentPrice: number
  proposedPrice: number
  deltaPercent: number
  requiresApproval: boolean
  reason: string
}

export interface ProductScoutRunInput {
  maxProducts?: number
  complianceMarkets?: string[]
}

export interface ScoutedProduct {
  productId: string
  title: string
  price: number
  inventory: number
  flag: 'low_inventory' | 'high_price' | 'normal'
}

export interface SupportRelayRunInput {
  autoReplyPolicy?: 'auto_reply_non_refund' | 'all_manual'
  toneSystemPrompt?: string
}

export interface RelayedThread {
  threadId: string
  subject: string
  action: 'auto_replied' | 'escalated'
  replyBody?: string
}

export interface AdsOptimizerRunInput {
  targetRoas?: number
  persistCampaigns?: (args: {
    platform: string
    campaigns: HarnessAdsCampaign[]
  }) => Promise<void>
  hasPendingAdsBudgetApproval?: (args: {
    platform: string
    platformCampaignId: string
    proposedDailyBudgetUsd: number
  }) => Promise<boolean>
}

export interface AdsOptimizerPlatformResult {
  platform: string
  ok: boolean
  count: number
  skipReason?: 'not_ads_capable' | 'harness_error' | 'no_harness'
}

export interface AdsOptimizerRunResult {
  runId: string
  synced: number
  perPlatform: AdsOptimizerPlatformResult[]
  budgetExceeded?: boolean
  approvalsRequested?: number
  budgetUpdatesApplied?: number
}

export const ADS_OPTIMIZER_HEARTBEAT_MS = 4 * 60 * 60 * 1000
export const INVENTORY_GUARD_HEARTBEAT_MS = 24 * 60 * 60 * 1000

export interface InventoryGuardPersistRow extends HarnessInventoryLevel {
  status: 'normal' | 'low' | 'out_of_stock'
  safetyThreshold: number
}

export interface InventoryGuardRunInput {
  safetyThreshold?: number
  replenishApprovalMinUnits?: number
  timeZone?: string
  enforceDailyWindow?: boolean
  persistInventoryLevels?: (args: {
    platform: string
    levels: InventoryGuardPersistRow[]
  }) => Promise<number>
  hasPendingInventoryAdjust?: (args: {
    platform: string
    platformProductId: string
    targetQuantity: number
  }) => Promise<boolean>
}

export interface InventoryGuardPlatformResult {
  platform: string
  ok: boolean
  count: number
  skipReason?: 'not_inventory_capable' | 'harness_error' | 'no_harness'
}

export interface InventoryGuardRunResult {
  runId: string
  synced: number
  perPlatform: InventoryGuardPlatformResult[]
  budgetExceeded?: boolean
  levelsPersisted?: number
  ticketsCreated?: number
  replenishApprovalsRequested?: number
  skippedDueToSchedule?: boolean
}

export interface ContentWriterRunInput {
  productId: string
  platform?: string
  tone?: 'professional' | 'casual' | 'luxury' | 'value'
  maxLength?: number
}

export interface ContentWriterResult {
  productId: string
  title: string
  description: string
  bulletPoints: string[]
  seoKeywords: string[]
}

export interface MarketIntelRunInput {
  platforms?: string[]
  maxProducts?: number
}

export interface MarketIntelCompetitorInsight {
  productId: string
  platform: string
  competitorMinPrice: number
  competitorAvgPrice: number
  pricePosition: 'below' | 'at' | 'above'
  recommendation?: string
}

export interface MarketIntelResult {
  runId: string
  analyzedProducts: number
  insights: MarketIntelCompetitorInsight[]
  featuresUpdated: number
}

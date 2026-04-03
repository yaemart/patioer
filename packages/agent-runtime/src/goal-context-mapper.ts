/**
 * Maps tenant operating modes (derived from tenant_goals) to structured
 * per-agent goalContext overrides.
 *
 * Operating modes:
 *   profit-first → protect margin, reduce ad spend
 *   launch       → relax margin, aggressive ads
 *   clearance    → accept losses, stop ads, no replenishment
 *   scale        → balanced growth
 *   daily        → default balanced ops
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OperatingMode = 'profit-first' | 'launch' | 'clearance' | 'scale' | 'daily'

export interface AgentGoalContext {
  priceSentinel: PriceSentinelGoalContext
  adsOptimizer: AdsOptimizerGoalContext
  inventoryGuard: InventoryGuardGoalContext
}

export interface PriceSentinelGoalContext {
  pricingStrategy: 'defensive' | 'aggressive-match' | 'balanced'
  minMarginPercent: number
  maxUndercutPercent: number
  approvalThresholdPercent: number
}

export interface AdsOptimizerGoalContext {
  budgetStrategy: 'aggressive' | 'conservative' | 'balanced' | 'pause'
  targetAcos: number
  maxDailyBudgetMultiplier: number
  allowNewCampaigns: boolean
}

export interface InventoryGuardGoalContext {
  replenishmentEnabled: boolean
  safetyStockDays: number
  urgencyThresholdDays: number
  acceptOverstock: boolean
}

// ---------------------------------------------------------------------------
// Mode → goalContext mappings
// ---------------------------------------------------------------------------

const MODE_MAP: Record<OperatingMode, AgentGoalContext> = {
  'profit-first': {
    priceSentinel: {
      pricingStrategy: 'defensive',
      minMarginPercent: 25,
      maxUndercutPercent: 3,
      approvalThresholdPercent: 8,
    },
    adsOptimizer: {
      budgetStrategy: 'conservative',
      targetAcos: 15,
      maxDailyBudgetMultiplier: 0.8,
      allowNewCampaigns: false,
    },
    inventoryGuard: {
      replenishmentEnabled: true,
      safetyStockDays: 30,
      urgencyThresholdDays: 14,
      acceptOverstock: false,
    },
  },
  launch: {
    priceSentinel: {
      pricingStrategy: 'aggressive-match',
      minMarginPercent: 5,
      maxUndercutPercent: 10,
      approvalThresholdPercent: 25,
    },
    adsOptimizer: {
      budgetStrategy: 'aggressive',
      targetAcos: 40,
      maxDailyBudgetMultiplier: 2.0,
      allowNewCampaigns: true,
    },
    inventoryGuard: {
      replenishmentEnabled: true,
      safetyStockDays: 45,
      urgencyThresholdDays: 21,
      acceptOverstock: true,
    },
  },
  clearance: {
    priceSentinel: {
      pricingStrategy: 'aggressive-match',
      minMarginPercent: -10,
      maxUndercutPercent: 20,
      approvalThresholdPercent: 50,
    },
    adsOptimizer: {
      budgetStrategy: 'pause',
      targetAcos: 100,
      maxDailyBudgetMultiplier: 0,
      allowNewCampaigns: false,
    },
    inventoryGuard: {
      replenishmentEnabled: false,
      safetyStockDays: 0,
      urgencyThresholdDays: 0,
      acceptOverstock: false,
    },
  },
  scale: {
    priceSentinel: {
      pricingStrategy: 'balanced',
      minMarginPercent: 12,
      maxUndercutPercent: 7,
      approvalThresholdPercent: 15,
    },
    adsOptimizer: {
      budgetStrategy: 'balanced',
      targetAcos: 25,
      maxDailyBudgetMultiplier: 1.3,
      allowNewCampaigns: true,
    },
    inventoryGuard: {
      replenishmentEnabled: true,
      safetyStockDays: 21,
      urgencyThresholdDays: 10,
      acceptOverstock: false,
    },
  },
  daily: {
    priceSentinel: {
      pricingStrategy: 'balanced',
      minMarginPercent: 15,
      maxUndercutPercent: 5,
      approvalThresholdPercent: 15,
    },
    adsOptimizer: {
      budgetStrategy: 'balanced',
      targetAcos: 20,
      maxDailyBudgetMultiplier: 1.0,
      allowNewCampaigns: true,
    },
    inventoryGuard: {
      replenishmentEnabled: true,
      safetyStockDays: 14,
      urgencyThresholdDays: 7,
      acceptOverstock: false,
    },
  },
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getGoalContextForMode(mode: OperatingMode): AgentGoalContext {
  return MODE_MAP[mode]
}

export function resolveOperatingMode(
  goals: Array<{ category: string; isActive: boolean; name: string }>,
): OperatingMode {
  const active = goals.filter((g) => g.isActive)
  if (active.length === 0) return 'daily'

  const nameLower = active
    .map((g) => g.name.toLowerCase())
    .join(' ')

  if (nameLower.includes('clearance') || nameLower.includes('liquidat')) return 'clearance'
  if (nameLower.includes('launch') || nameLower.includes('新品')) return 'launch'
  if (nameLower.includes('profit') || nameLower.includes('margin') || nameLower.includes('利润')) return 'profit-first'
  if (nameLower.includes('scale') || nameLower.includes('growth') || nameLower.includes('增长')) return 'scale'

  const categories = new Set(active.map((g) => g.category))
  if (categories.has('margin')) return 'profit-first'
  if (categories.has('revenue') && !categories.has('margin')) return 'scale'

  return 'daily'
}

export function getAgentGoalContext(
  agentScope: string,
  mode: OperatingMode,
): Record<string, unknown> {
  const ctx = getGoalContextForMode(mode)
  switch (agentScope) {
    case 'price-sentinel': return { ...ctx.priceSentinel }
    case 'ads-optimizer': return { ...ctx.adsOptimizer }
    case 'inventory-guard': return { ...ctx.inventoryGuard }
    default: return {}
  }
}

export const VALID_OPERATING_MODES: OperatingMode[] = [
  'profit-first', 'launch', 'clearance', 'scale', 'daily',
]

export function isValidOperatingMode(mode: string): mode is OperatingMode {
  return VALID_OPERATING_MODES.includes(mode as OperatingMode)
}

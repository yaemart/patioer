import { ELECTROOS_AGENT_IDS, type ElectroOsAgentId } from '@patioer/shared'

export type ElectroOsAgentTrigger =
  | 'daily'
  | 'hourly'
  | 'weekly'
  | 'monthly'
  | 'event-driven'
  | 'on-demand'

export interface ElectroOsAgentSeedEntry {
  id: ElectroOsAgentId
  name: string
  model: string
  trigger: ElectroOsAgentTrigger
  schedule?: string
  monthlyBudgetUsd: number
  config: Record<string, unknown>
}

export const ELECTROOS_FULL_SEED: readonly ElectroOsAgentSeedEntry[] = [
  {
    id: 'ceo-agent',
    name: 'CEO Agent',
    model: 'claude-opus-4-6',
    trigger: 'daily',
    schedule: '0 8 * * *',
    monthlyBudgetUsd: 80,
    config: { role: 'leadership', coordinatesAllAgents: true },
  },
  {
    id: 'product-scout',
    name: 'Product Scout',
    model: 'claude-sonnet-4-6',
    trigger: 'daily',
    schedule: '0 6 * * *',
    monthlyBudgetUsd: 30,
    config: { role: 'product-discovery', maxProductsPerRun: 100 },
  },
  {
    id: 'price-sentinel',
    name: 'Price Sentinel',
    model: 'claude-haiku-4-5',
    trigger: 'hourly',
    schedule: '0 * * * *',
    monthlyBudgetUsd: 50,
    config: { role: 'pricing', approvalThresholdPercent: 15 },
  },
  {
    id: 'support-relay',
    name: 'Support Relay',
    model: 'claude-sonnet-4-6',
    trigger: 'event-driven',
    monthlyBudgetUsd: 80,
    config: { role: 'customer-support', autoReplyPolicy: 'auto_reply_non_refund' },
  },
  {
    id: 'ads-optimizer',
    name: 'Ads Optimizer',
    model: 'claude-sonnet-4-6',
    trigger: 'hourly',
    schedule: '0 */4 * * *',
    monthlyBudgetUsd: 60,
    config: { role: 'advertising', targetRoas: 3.0, approvalBudgetThresholdUsd: 500 },
  },
  {
    id: 'inventory-guard',
    name: 'Inventory Guard',
    model: 'claude-haiku-4-5',
    trigger: 'daily',
    schedule: '0 8 * * *',
    monthlyBudgetUsd: 20,
    config: { role: 'inventory', safetyThreshold: 10, replenishApprovalMinUnits: 50 },
  },
  {
    id: 'content-writer',
    name: 'Content Writer',
    model: 'claude-sonnet-4-6',
    trigger: 'on-demand',
    monthlyBudgetUsd: 40,
    config: { role: 'content', defaultTone: 'professional', maxLength: 2000 },
  },
  {
    id: 'market-intel',
    name: 'Market Intel',
    model: 'claude-sonnet-4-6',
    trigger: 'weekly',
    schedule: '0 6 * * 1',
    monthlyBudgetUsd: 30,
    config: { role: 'market-intelligence', maxProductsPerRun: 50 },
  },
  {
    id: 'finance-agent',
    name: 'Finance Agent',
    model: 'claude-sonnet-4-6',
    trigger: 'monthly',
    schedule: '0 9 1 * *',
    monthlyBudgetUsd: 40,
    config: { role: 'finance', reportType: 'pnl' },
  },
] as const

export const ELECTROOS_MONTHLY_BUDGET_USD = ELECTROOS_FULL_SEED.reduce(
  (sum, a) => sum + a.monthlyBudgetUsd, 0,
)

export function validateSeedCompleteness(): { valid: boolean; missing: string[] } {
  const seedIds = new Set(ELECTROOS_FULL_SEED.map((e) => e.id))
  const missing = ELECTROOS_AGENT_IDS.filter((id) => !seedIds.has(id))
  return { valid: missing.length === 0, missing }
}

export interface PlatformAgentSeedEntry {
  id: string
  name: string
  model: string
  trigger: ElectroOsAgentTrigger
  schedule: string
  monthlyBudgetUsd: number
  config: Record<string, unknown>
}

export const CS_AGENT_SEED: PlatformAgentSeedEntry = {
  id: 'customer-success',
  name: 'Customer Success',
  model: 'claude-sonnet-4-6',
  trigger: 'daily',
  schedule: '0 9 * * *',
  monthlyBudgetUsd: 200,
  config: {
    role: 'customer-success',
    isPlatformLevel: true,
    healthThresholds: { intervention: 40, upsell: 80 },
  },
}

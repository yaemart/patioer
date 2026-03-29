import { ELECTROOS_AGENT_IDS, type ElectroOsAgentId } from '@patioer/shared'
import type { AgentContext } from './context.js'
import { runAdsOptimizer } from './agents/ads-optimizer.agent.js'
import { runCeoAgent } from './agents/ceo-agent.agent.js'
import { runContentWriter } from './agents/content-writer.agent.js'
import { runFinanceAgent } from './agents/finance-agent.agent.js'
import { runInventoryGuard } from './agents/inventory-guard.agent.js'
import { runMarketIntel } from './agents/market-intel.agent.js'
import { runPriceSentinel } from './agents/price-sentinel.agent.js'
import { runProductScout } from './agents/product-scout.agent.js'

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

export interface ElectroOsAgentCatalogEntry extends ElectroOsAgentSeedEntry {
  runHeartbeat(ctx: AgentContext): Promise<void>
}

function currentMonthContext(): { month: number; year: number } {
  const now = new Date()
  return {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  }
}

export const ELECTROOS_AGENT_CATALOG: Readonly<Record<ElectroOsAgentId, ElectroOsAgentCatalogEntry>> = {
  'ceo-agent': {
    id: 'ceo-agent',
    name: 'CEO Agent',
    model: 'claude-opus-4-6',
    trigger: 'daily',
    schedule: '0 8 * * *',
    monthlyBudgetUsd: 80,
    config: { role: 'leadership', coordinatesAllAgents: true },
    async runHeartbeat(ctx) {
      await runCeoAgent(ctx, {})
    },
  },
  'product-scout': {
    id: 'product-scout',
    name: 'Product Scout',
    model: 'claude-sonnet-4-6',
    trigger: 'daily',
    schedule: '0 6 * * *',
    monthlyBudgetUsd: 30,
    config: { role: 'product-discovery', maxProductsPerRun: 100 },
    async runHeartbeat(ctx) {
      await runProductScout(ctx, { maxProducts: 10 })
    },
  },
  'price-sentinel': {
    id: 'price-sentinel',
    name: 'Price Sentinel',
    model: 'claude-haiku-4-5',
    trigger: 'hourly',
    schedule: '0 * * * *',
    monthlyBudgetUsd: 50,
    config: { role: 'pricing', approvalThresholdPercent: 15 },
    async runHeartbeat(ctx) {
      await runPriceSentinel(ctx, { proposals: [] })
    },
  },
  'support-relay': {
    id: 'support-relay',
    name: 'Support Relay',
    model: 'claude-sonnet-4-6',
    trigger: 'event-driven',
    monthlyBudgetUsd: 80,
    config: { role: 'customer-support', autoReplyPolicy: 'auto_reply_non_refund' },
    async runHeartbeat(ctx) {
      await ctx.logAction('heartbeat.support_relay.probe', { status: 'event-driven-skip' })
    },
  },
  'ads-optimizer': {
    id: 'ads-optimizer',
    name: 'Ads Optimizer',
    model: 'claude-sonnet-4-6',
    trigger: 'hourly',
    schedule: '0 */4 * * *',
    monthlyBudgetUsd: 60,
    config: { role: 'advertising', targetRoas: 3.0, approvalBudgetThresholdUsd: 500 },
    async runHeartbeat(ctx) {
      await runAdsOptimizer(ctx, {})
    },
  },
  'inventory-guard': {
    id: 'inventory-guard',
    name: 'Inventory Guard',
    model: 'claude-haiku-4-5',
    trigger: 'daily',
    schedule: '0 8 * * *',
    monthlyBudgetUsd: 20,
    config: { role: 'inventory', safetyThreshold: 10, replenishApprovalMinUnits: 50 },
    async runHeartbeat(ctx) {
      await runInventoryGuard(ctx, {})
    },
  },
  'content-writer': {
    id: 'content-writer',
    name: 'Content Writer',
    model: 'claude-sonnet-4-6',
    trigger: 'on-demand',
    monthlyBudgetUsd: 40,
    config: { role: 'content', defaultTone: 'professional', maxLength: 2000 },
    async runHeartbeat(ctx) {
      await runContentWriter(ctx, { productId: 'heartbeat-probe' })
    },
  },
  'market-intel': {
    id: 'market-intel',
    name: 'Market Intel',
    model: 'claude-sonnet-4-6',
    trigger: 'weekly',
    schedule: '0 6 * * 1',
    monthlyBudgetUsd: 30,
    config: { role: 'market-intelligence', maxProductsPerRun: 50 },
    async runHeartbeat(ctx) {
      await runMarketIntel(ctx, { maxProducts: 5 })
    },
  },
  'finance-agent': {
    id: 'finance-agent',
    name: 'Finance Agent',
    model: 'claude-sonnet-4-6',
    trigger: 'monthly',
    schedule: '0 9 1 * *',
    monthlyBudgetUsd: 40,
    config: { role: 'finance', reportType: 'pnl' },
    async runHeartbeat(ctx) {
      const { month, year } = currentMonthContext()
      await runFinanceAgent(ctx, { month, year })
    },
  },
}

export const ELECTROOS_FULL_SEED: readonly ElectroOsAgentSeedEntry[] = ELECTROOS_AGENT_IDS.map((id) => {
  const entry = ELECTROOS_AGENT_CATALOG[id]
  return {
    id: entry.id,
    name: entry.name,
    model: entry.model,
    trigger: entry.trigger,
    schedule: entry.schedule,
    monthlyBudgetUsd: entry.monthlyBudgetUsd,
    config: entry.config,
  }
})

export const ELECTROOS_MONTHLY_BUDGET_USD = ELECTROOS_FULL_SEED.reduce(
  (sum, a) => sum + a.monthlyBudgetUsd, 0,
)

export function validateSeedCompleteness(): { valid: boolean; missing: string[] } {
  const catalogIds = new Set(Object.keys(ELECTROOS_AGENT_CATALOG))
  const missing = ELECTROOS_AGENT_IDS.filter((id) => !catalogIds.has(id))
  return { valid: missing.length === 0, missing }
}

export function getElectroOsHeartbeatEntry(agentId: ElectroOsAgentId): ElectroOsAgentCatalogEntry {
  return ELECTROOS_AGENT_CATALOG[agentId]
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

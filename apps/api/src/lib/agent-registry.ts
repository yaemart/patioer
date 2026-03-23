import type { FastifyRequest } from 'fastify'
import {
  runAdsOptimizer,
  runInventoryGuard,
  runPriceSentinel,
  runProductScout,
  runSupportRelay,
} from '@patioer/agent-runtime'
import type { AgentContext } from '@patioer/agent-runtime'
import type {
  AdsOptimizerPlatformResult,
  InventoryGuardPlatformResult,
  PriceDecision,
  RelayedThread,
  ScoutedProduct,
} from '@patioer/agent-runtime'
import {
  buildAdsOptimizerInput,
  buildInventoryGuardInput,
  buildPriceSentinelInput,
  buildProductScoutInput,
  buildSupportRelayInput,
} from './agent-inputs.js'

export interface ExecuteAgentResponse {
  ok: true
  agentId: string
  executedAt: string
  decisions?: PriceDecision[]
  scouted?: ScoutedProduct[]
  relayed?: RelayedThread[]
  adsOptimizer?: {
    runId: string
    synced: number
    perPlatform: AdsOptimizerPlatformResult[]
    budgetExceeded?: boolean
    approvalsRequested?: number
    budgetUpdatesApplied?: number
  }
  inventoryGuard?: {
    runId: string
    synced: number
    perPlatform: InventoryGuardPlatformResult[]
    budgetExceeded?: boolean
    levelsPersisted?: number
    ticketsCreated?: number
    replenishApprovalsRequested?: number
    skippedDueToSchedule?: boolean
  }
}

export type AgentRunner = (
  request: FastifyRequest,
  agentRow: { id: string; type: string; goalContext: string | null },
  ctx: AgentContext,
) => Promise<ExecuteAgentResponse>

const _registry = new Map<string, AgentRunner>()

export function registerRunner(type: string, runner: AgentRunner): void {
  _registry.set(type, runner)
}

export function getRunner(type: string): AgentRunner | undefined {
  return _registry.get(type)
}

registerRunner('price-sentinel', async (_req, agentRow, ctx) => {
  const input = buildPriceSentinelInput(agentRow.goalContext ?? '')
  const result = await runPriceSentinel(ctx, input)
  return { ok: true, agentId: agentRow.id, executedAt: new Date().toISOString(), decisions: result.decisions }
})

registerRunner('product-scout', async (_req, agentRow, ctx) => {
  const input = buildProductScoutInput(agentRow.goalContext ?? '')
  const result = await runProductScout(ctx, input)
  return { ok: true, agentId: agentRow.id, executedAt: new Date().toISOString(), scouted: result.scouted }
})

registerRunner('support-relay', async (_req, agentRow, ctx) => {
  const input = buildSupportRelayInput(agentRow.goalContext ?? '')
  const result = await runSupportRelay(ctx, input)
  return { ok: true, agentId: agentRow.id, executedAt: new Date().toISOString(), relayed: result.relayed }
})

registerRunner('ads-optimizer', async (request, agentRow, ctx) => {
  const input = buildAdsOptimizerInput(request, request.tenantId!, agentRow.id, agentRow.goalContext)
  const result = await runAdsOptimizer(ctx, input)
  return {
    ok: true,
    agentId: agentRow.id,
    executedAt: new Date().toISOString(),
    adsOptimizer: {
      runId: result.runId,
      synced: result.synced,
      perPlatform: result.perPlatform,
      budgetExceeded: result.budgetExceeded,
      approvalsRequested: result.approvalsRequested,
      budgetUpdatesApplied: result.budgetUpdatesApplied,
    },
  }
})

registerRunner('inventory-guard', async (request, agentRow, ctx) => {
  const input = buildInventoryGuardInput(request, request.tenantId!, agentRow.id, agentRow.goalContext)
  const result = await runInventoryGuard(ctx, input)
  return {
    ok: true,
    agentId: agentRow.id,
    executedAt: new Date().toISOString(),
    inventoryGuard: {
      runId: result.runId,
      synced: result.synced,
      perPlatform: result.perPlatform,
      budgetExceeded: result.budgetExceeded,
      levelsPersisted: result.levelsPersisted,
      ticketsCreated: result.ticketsCreated,
      replenishApprovalsRequested: result.replenishApprovalsRequested,
      skippedDueToSchedule: result.skippedDueToSchedule,
    },
  }
})

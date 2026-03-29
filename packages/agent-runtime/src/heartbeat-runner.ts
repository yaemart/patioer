import type { AgentContext } from './context.js'
import { ELECTROOS_FULL_SEED, type ElectroOsAgentSeedEntry } from './electroos-seed.js'
import { randomRunId } from './run-id.js'
import { runProductScout } from './agents/product-scout.agent.js'
import { runPriceSentinel } from './agents/price-sentinel.agent.js'
import { runAdsOptimizer } from './agents/ads-optimizer.agent.js'
import { runInventoryGuard } from './agents/inventory-guard.agent.js'
import { runContentWriter } from './agents/content-writer.agent.js'
import { runMarketIntel } from './agents/market-intel.agent.js'
import { runFinanceAgent } from './agents/finance-agent.agent.js'
import { runCeoAgent } from './agents/ceo-agent.agent.js'
import type { ElectroOsAgentId } from '@patioer/shared'

export interface HeartbeatTickResult {
  agentId: string
  runId: string
  startedAt: string
  completedAt: string
  durationMs: number
  success: boolean
  error?: string
}

export interface HeartbeatCycleResult {
  cycleId: string
  cycleNumber: number
  startedAt: string
  completedAt: string
  results: HeartbeatTickResult[]
  allHealthy: boolean
}

export interface HeartbeatRunEvidence {
  heartbeatId: string
  startedAt: string
  completedAt: string
  totalCycles: number
  totalTicks: number
  failures: HeartbeatTickResult[]
  healthy: boolean
  cycles: HeartbeatCycleResult[]
}

export interface HeartbeatRunnerOptions {
  ctxFactory: (agentId: string) => AgentContext
  agentFilter?: ElectroOsAgentId[]
  onTick?: (result: HeartbeatTickResult) => void
  onCycle?: (result: HeartbeatCycleResult) => void
}

async function executeAgent(
  seed: ElectroOsAgentSeedEntry,
  ctx: AgentContext,
): Promise<{ success: boolean; error?: string }> {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  switch (seed.id) {
    case 'product-scout':
      await runProductScout(ctx, { maxProducts: 10 })
      return { success: true }
    case 'price-sentinel':
      await runPriceSentinel(ctx, { proposals: [] })
      return { success: true }
    case 'ads-optimizer':
      await runAdsOptimizer(ctx, {})
      return { success: true }
    case 'inventory-guard':
      await runInventoryGuard(ctx, {})
      return { success: true }
    case 'content-writer':
      await runContentWriter(ctx, { productId: 'heartbeat-probe' })
      return { success: true }
    case 'market-intel':
      await runMarketIntel(ctx, { maxProducts: 5 })
      return { success: true }
    case 'finance-agent':
      await runFinanceAgent(ctx, { month, year })
      return { success: true }
    case 'ceo-agent':
      await runCeoAgent(ctx, {})
      return { success: true }
    case 'support-relay':
      await ctx.logAction('heartbeat.support_relay.probe', { status: 'event-driven-skip' })
      return { success: true }
    default: {
      const _exhaustive: never = seed.id
      return { success: false, error: `Unknown agent: ${_exhaustive}` }
    }
  }
}

export class HeartbeatRunner {
  private readonly options: HeartbeatRunnerOptions
  private readonly agents: readonly ElectroOsAgentSeedEntry[]

  constructor(options: HeartbeatRunnerOptions) {
    this.options = options
    this.agents = options.agentFilter
      ? ELECTROOS_FULL_SEED.filter((s) => options.agentFilter!.includes(s.id))
      : ELECTROOS_FULL_SEED
  }

  async runCycle(cycleNumber: number): Promise<HeartbeatCycleResult> {
    const cycleId = randomRunId()
    const startedAt = new Date().toISOString()
    const results: HeartbeatTickResult[] = []

    for (const seed of this.agents) {
      const tickRunId = randomRunId()
      const tickStart = new Date().toISOString()
      const t0 = Date.now()

      let success: boolean
      let error: string | undefined

      try {
        const ctx = this.options.ctxFactory(seed.id)
        const result = await executeAgent(seed, ctx)
        success = result.success
        error = result.error
      } catch (err) {
        success = false
        error = err instanceof Error ? err.message : String(err)
      }

      const tickResult: HeartbeatTickResult = {
        agentId: seed.id,
        runId: tickRunId,
        startedAt: tickStart,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        success,
        error,
      }

      results.push(tickResult)
      this.options.onTick?.(tickResult)
    }

    const completedAt = new Date().toISOString()
    const allHealthy = results.every((r) => r.success)

    const cycleResult: HeartbeatCycleResult = {
      cycleId,
      cycleNumber,
      startedAt,
      completedAt,
      results,
      allHealthy,
    }

    this.options.onCycle?.(cycleResult)
    return cycleResult
  }

  async runHeartbeat(totalCycles: number): Promise<HeartbeatRunEvidence> {
    const heartbeatId = randomRunId()
    const startedAt = new Date().toISOString()
    const cycles: HeartbeatCycleResult[] = []

    for (let i = 1; i <= totalCycles; i++) {
      const cycle = await this.runCycle(i)
      cycles.push(cycle)
    }

    const allTicks = cycles.flatMap((c) => c.results)
    const failures = allTicks.filter((t) => !t.success)

    return {
      heartbeatId,
      startedAt,
      completedAt: new Date().toISOString(),
      totalCycles: cycles.length,
      totalTicks: allTicks.length,
      failures,
      healthy: failures.length === 0,
      cycles,
    }
  }
}

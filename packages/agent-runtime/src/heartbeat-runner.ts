import type { AgentContext } from './context.js'
import {
  ELECTROOS_FULL_SEED,
  getElectroOsHeartbeatEntry,
  type ElectroOsAgentSeedEntry,
} from './electroos-seed.js'
import { randomRunId } from './run-id.js'
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
        const entry = getElectroOsHeartbeatEntry(seed.id)
        await entry.runHeartbeat(ctx)
        success = true
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

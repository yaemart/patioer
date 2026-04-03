import type { AgentContext } from './context.js'
import type { GovernanceSettings } from './ports.js'

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface DecisionContext {
  governance: GovernanceSettings
  sopGoalContext: Record<string, unknown> | null
  sopSystemPrompt: string | null
  degradation: DegradationFlags
  platformData: Record<string, unknown>
}

export interface DegradationFlags {
  profitDataMissing: boolean
  accountHealthCritical: boolean
  cashFlowTight: boolean
}

export const NO_DEGRADATION: DegradationFlags = {
  profitDataMissing: false,
  accountHealthCritical: false,
  cashFlowTight: false,
}

export type GovernedAction =
  | 'auto_execute'
  | 'requires_approval'
  | 'degraded_suggest_only'
  | 'blocked'

export interface GovernedDecision<TDecision> {
  decision: TDecision
  action: GovernedAction
  reason: string
  confidence: number
  guard: {
    degraded: boolean
    constitutionTriggered: boolean
    businessGuardTriggered: boolean
  }
}

export interface PipelineResult<TDecision> {
  decisions: GovernedDecision<TDecision>[]
  executedCount: number
  approvalCount: number
  blockedCount: number
  degradedCount: number
}

// ---------------------------------------------------------------------------
// Pipeline interface
// ---------------------------------------------------------------------------

export interface DecisionPipeline<TInput, TDecision> {
  readonly scope: string

  gather(ctx: AgentContext, input: TInput): Promise<DecisionContext>

  reason(ctx: AgentContext, context: DecisionContext, input: TInput): Promise<TDecision[]>

  govern(
    ctx: AgentContext,
    decisions: TDecision[],
    context: DecisionContext,
  ): Promise<GovernedDecision<TDecision>[]>

  execute(
    ctx: AgentContext,
    governed: GovernedDecision<TDecision>[],
    context: DecisionContext,
  ): Promise<PipelineResult<TDecision>>

  remember(
    ctx: AgentContext,
    result: PipelineResult<TDecision>,
    context: DecisionContext,
  ): Promise<void>
}

// ---------------------------------------------------------------------------
// Impact estimation helpers
// ---------------------------------------------------------------------------

function estimateGmvImpact<T>(decisions: GovernedDecision<T>[], scope: string): number | null {
  if (scope === 'price-sentinel') {
    let total = 0
    for (const g of decisions) {
      if (g.action !== 'auto_execute') continue
      const d = g.decision as Record<string, unknown>
      const delta = Number(d.proposedPrice ?? 0) - Number(d.currentPrice ?? 0)
      total += delta
    }
    return Math.round(total * 100) / 100 || null
  }
  if (scope === 'ads-optimizer') {
    let total = 0
    for (const g of decisions) {
      if (g.action !== 'auto_execute') continue
      const d = g.decision as Record<string, unknown>
      const delta = Number(d.proposedDailyBudget ?? 0) - Number(d.currentDailyBudget ?? 0)
      total += delta
    }
    return Math.round(total * 100) / 100 || null
  }
  return null
}

function estimateMarginImpact<T>(decisions: GovernedDecision<T>[], scope: string): number | null {
  if (scope === 'price-sentinel') {
    let total = 0
    for (const g of decisions) {
      if (g.action !== 'auto_execute') continue
      const d = g.decision as Record<string, unknown>
      total += Number(d.expectedMarginDelta ?? 0)
    }
    return Math.round(total * 1000) / 1000 || null
  }
  return null
}

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

export async function runPipeline<TInput, TDecision>(
  pipeline: DecisionPipeline<TInput, TDecision>,
  ctx: AgentContext,
  input: TInput,
): Promise<PipelineResult<TDecision>> {
  const context = await pipeline.gather(ctx, input)

  const decisions = await pipeline.reason(ctx, context, input)
  if (decisions.length === 0) {
    return { decisions: [], executedCount: 0, approvalCount: 0, blockedCount: 0, degradedCount: 0 }
  }

  const governed = await pipeline.govern(ctx, decisions, context)

  const result = await pipeline.execute(ctx, governed, context)

  await pipeline.remember(ctx, result, context)

  const avgConfidence = result.decisions.length > 0
    ? result.decisions.reduce((sum, d) => sum + d.confidence, 0) / result.decisions.length
    : 0

  await ctx.logAction(`${pipeline.scope}.pipeline.completed`, {
    total: result.decisions.length,
    executed: result.executedCount,
    approvals: result.approvalCount,
    blocked: result.blockedCount,
    degraded: result.degradedCount,
    degradation: context.degradation,
    confidence: Math.round(avgConfidence * 1000) / 1000,
    metrics: {
      autoExecuteRate: result.decisions.length > 0
        ? result.executedCount / result.decisions.length
        : 0,
      approvalRate: result.decisions.length > 0
        ? result.approvalCount / result.decisions.length
        : 0,
      gmvImpact: estimateGmvImpact(result.decisions, pipeline.scope),
      marginImpact: estimateMarginImpact(result.decisions, pipeline.scope),
    },
    scenarioId: context.sopGoalContext
      ? (context.sopGoalContext as Record<string, unknown>).scenarioId ?? null
      : null,
  })

  return result
}

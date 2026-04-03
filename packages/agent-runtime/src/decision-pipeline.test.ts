import { describe, expect, it, vi } from 'vitest'
import type { AgentContext } from './context.js'
import type { DecisionPipeline, DecisionContext, GovernedDecision, PipelineResult } from './decision-pipeline.js'
import { runPipeline, NO_DEGRADATION } from './decision-pipeline.js'
import { DEFAULT_GOVERNANCE_SETTINGS } from './ports.js'

function createMinimalContext(): AgentContext {
  return {
    tenantId: 'tenant-test',
    agentId: 'agent-test',
    getHarness: () => { throw new Error('not wired') },
    getEnabledPlatforms: () => ['shopify'],
    llm: vi.fn().mockResolvedValue({ text: '{}' }),
    budget: { isExceeded: vi.fn().mockResolvedValue(false) },
    logAction: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue(undefined),
    createTicket: vi.fn().mockResolvedValue(undefined),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    getRecentEvents: vi.fn().mockResolvedValue([]),
    getEventsForAgent: vi.fn().mockResolvedValue([]),
    describeDataOsCapabilities: () => 'DataOS unavailable',
    getGovernanceSettings: vi.fn().mockResolvedValue({ ...DEFAULT_GOVERNANCE_SETTINGS }),
    getEffectiveGovernance: vi.fn().mockResolvedValue({ ...DEFAULT_GOVERNANCE_SETTINGS }),
    isHumanInLoop: vi.fn().mockResolvedValue(false),
    getActiveSop: vi.fn().mockResolvedValue(null),
  }
}

interface TestDecision {
  id: string
  value: number
}

function createTestPipeline(overrides?: {
  decisions?: TestDecision[]
  governed?: GovernedDecision<TestDecision>[]
}): DecisionPipeline<string, TestDecision> {
  const baseContext: DecisionContext = {
    governance: { ...DEFAULT_GOVERNANCE_SETTINGS },
    sopGoalContext: null,
    sopSystemPrompt: null,
    degradation: { ...NO_DEGRADATION },
    platformData: {},
  }

  const decisions = overrides?.decisions ?? [{ id: 'dec-1', value: 10 }]
  const governed = overrides?.governed ?? decisions.map((d) => ({
    decision: d,
    action: 'auto_execute' as const,
    reason: 'within threshold',
    confidence: 0.95,
    guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: false },
  }))

  return {
    scope: 'test-agent',
    gather: vi.fn().mockResolvedValue(baseContext),
    reason: vi.fn().mockResolvedValue(decisions),
    govern: vi.fn().mockResolvedValue(governed),
    execute: vi.fn().mockResolvedValue({
      decisions: governed,
      executedCount: governed.filter((g) => g.action === 'auto_execute').length,
      approvalCount: governed.filter((g) => g.action === 'requires_approval').length,
      blockedCount: governed.filter((g) => g.action === 'blocked').length,
      degradedCount: governed.filter((g) => g.action === 'degraded_suggest_only').length,
    } satisfies PipelineResult<TestDecision>),
    remember: vi.fn().mockResolvedValue(undefined),
  }
}

describe('runPipeline', () => {
  it('calls all five stages in order', async () => {
    const ctx = createMinimalContext()
    const pipeline = createTestPipeline()

    const result = await runPipeline(pipeline, ctx, 'input-data')

    expect(pipeline.gather).toHaveBeenCalledWith(ctx, 'input-data')
    expect(pipeline.reason).toHaveBeenCalledOnce()
    expect(pipeline.govern).toHaveBeenCalledOnce()
    expect(pipeline.execute).toHaveBeenCalledOnce()
    expect(pipeline.remember).toHaveBeenCalledOnce()

    expect(result.executedCount).toBe(1)
    expect(result.approvalCount).toBe(0)
  })

  it('short-circuits on empty decisions', async () => {
    const ctx = createMinimalContext()
    const pipeline = createTestPipeline({ decisions: [] })

    const result = await runPipeline(pipeline, ctx, 'empty')

    expect(pipeline.reason).toHaveBeenCalledOnce()
    expect(pipeline.govern).not.toHaveBeenCalled()
    expect(pipeline.execute).not.toHaveBeenCalled()
    expect(pipeline.remember).not.toHaveBeenCalled()
    expect(result.decisions).toEqual([])
  })

  it('logs pipeline completion with counts', async () => {
    const ctx = createMinimalContext()
    const governed: GovernedDecision<TestDecision>[] = [
      { decision: { id: '1', value: 10 }, action: 'auto_execute', reason: 'ok', confidence: 0.9, guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: false } },
      { decision: { id: '2', value: 20 }, action: 'requires_approval', reason: 'over threshold', confidence: 0.7, guard: { degraded: false, constitutionTriggered: true, businessGuardTriggered: false } },
      { decision: { id: '3', value: 30 }, action: 'blocked', reason: 'critical', confidence: 0.5, guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: true } },
    ]
    const pipeline = createTestPipeline({
      decisions: governed.map((g) => g.decision),
      governed,
    })

    await runPipeline(pipeline, ctx, 'mixed')

    expect(ctx.logAction).toHaveBeenCalledWith('test-agent.pipeline.completed', expect.objectContaining({
      total: 3,
      executed: 1,
      approvals: 1,
      blocked: 1,
    }))
  })

  it('passes context through all stages', async () => {
    const ctx = createMinimalContext()
    const pipeline = createTestPipeline()
    const customContext: DecisionContext = {
      governance: { ...DEFAULT_GOVERNANCE_SETTINGS, priceChangeThreshold: 10 },
      sopGoalContext: { mode: 'launch' },
      sopSystemPrompt: 'aggressive pricing',
      degradation: { profitDataMissing: false, accountHealthCritical: false, cashFlowTight: true },
      platformData: { competitorCount: 5 },
    }
    ;(pipeline.gather as ReturnType<typeof vi.fn>).mockResolvedValue(customContext)

    await runPipeline(pipeline, ctx, 'context-test')

    expect(pipeline.reason).toHaveBeenCalledWith(ctx, customContext, 'context-test')
    expect(pipeline.govern).toHaveBeenCalledWith(ctx, expect.any(Array), customContext)
  })
})

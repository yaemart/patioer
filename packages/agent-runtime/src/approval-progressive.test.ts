import { describe, expect, it } from 'vitest'
import type { GovernedDecision } from './decision-pipeline.js'
import {
  evaluateAutoApprovable,
  resolveEffectiveAction,
  computeMaturityMetrics,
  AUTO_APPROVE_CONFIDENCE_THRESHOLD,
} from './approval-progressive.js'

function makeGoverned(overrides: Partial<GovernedDecision<string>>): GovernedDecision<string> {
  return {
    decision: 'test-decision',
    action: 'requires_approval',
    reason: 'test reason',
    confidence: 0.95,
    guard: {
      degraded: false,
      constitutionTriggered: true,
      businessGuardTriggered: false,
    },
    ...overrides,
  }
}

describe('evaluateAutoApprovable', () => {
  it('marks high-confidence constitutional approval as auto-approvable', () => {
    const g = makeGoverned({ confidence: 0.95, guard: { degraded: false, constitutionTriggered: true, businessGuardTriggered: false } })
    const result = evaluateAutoApprovable(g)
    expect(result.autoApprovable).toBe(true)
    expect(result.autoApproveReason).toContain('95%')
  })

  it('marks high-confidence non-constitutional approval as auto-approvable', () => {
    const g = makeGoverned({ confidence: 0.92, guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: false } })
    const result = evaluateAutoApprovable(g)
    expect(result.autoApprovable).toBe(true)
    expect(result.autoApproveReason).toContain('no constitutional trigger')
  })

  it('rejects low-confidence approvals', () => {
    const g = makeGoverned({ confidence: 0.7 })
    const result = evaluateAutoApprovable(g)
    expect(result.autoApprovable).toBe(false)
  })

  it('rejects degraded approvals even with high confidence', () => {
    const g = makeGoverned({ confidence: 0.95, guard: { degraded: true, constitutionTriggered: true, businessGuardTriggered: false } })
    const result = evaluateAutoApprovable(g)
    expect(result.autoApprovable).toBe(false)
  })

  it('rejects business-guard-triggered approvals even with high confidence', () => {
    const g = makeGoverned({ confidence: 0.95, guard: { degraded: false, constitutionTriggered: false, businessGuardTriggered: true } })
    const result = evaluateAutoApprovable(g)
    expect(result.autoApprovable).toBe(false)
  })

  it('returns false for non-approval actions', () => {
    const g = makeGoverned({ action: 'auto_execute' })
    const result = evaluateAutoApprovable(g)
    expect(result.autoApprovable).toBe(false)
  })

  it('uses exact threshold boundary', () => {
    const atThreshold = makeGoverned({ confidence: AUTO_APPROVE_CONFIDENCE_THRESHOLD })
    expect(evaluateAutoApprovable(atThreshold).autoApprovable).toBe(true)

    const belowThreshold = makeGoverned({ confidence: AUTO_APPROVE_CONFIDENCE_THRESHOLD - 0.01 })
    expect(evaluateAutoApprovable(belowThreshold).autoApprovable).toBe(false)
  })
})

describe('resolveEffectiveAction', () => {
  it('keeps requires_approval in approval_required mode even if auto-approvable', () => {
    const g = makeGoverned({ confidence: 0.95 })
    const autoApprove = evaluateAutoApprovable(g)
    const action = resolveEffectiveAction(g, 'approval_required', autoApprove)
    expect(action).toBe('requires_approval')
  })

  it('upgrades to auto_execute in approval_informed mode when auto-approvable', () => {
    const g = makeGoverned({ confidence: 0.95 })
    const autoApprove = evaluateAutoApprovable(g)
    const action = resolveEffectiveAction(g, 'approval_informed', autoApprove)
    expect(action).toBe('auto_execute')
  })

  it('keeps requires_approval in approval_informed when NOT auto-approvable', () => {
    const g = makeGoverned({ confidence: 0.5 })
    const autoApprove = evaluateAutoApprovable(g)
    const action = resolveEffectiveAction(g, 'approval_informed', autoApprove)
    expect(action).toBe('requires_approval')
  })

  it('passes through blocked/degraded/auto_execute unchanged', () => {
    for (const baseAction of ['blocked', 'degraded_suggest_only', 'auto_execute'] as const) {
      const g = makeGoverned({ action: baseAction, confidence: 0.95 })
      const autoApprove = evaluateAutoApprovable(g)
      const action = resolveEffectiveAction(g, 'approval_informed', autoApprove)
      expect(action).toBe(baseAction)
    }
  })
})

describe('computeMaturityMetrics', () => {
  it('computes correct rates for mixed decisions', () => {
    const decisions: GovernedDecision<string>[] = [
      makeGoverned({ action: 'auto_execute', confidence: 0.8 }),
      makeGoverned({ action: 'requires_approval', confidence: 0.95 }),
      makeGoverned({ action: 'requires_approval', confidence: 0.5 }),
      makeGoverned({ action: 'blocked', confidence: 0.3 }),
    ]

    const metrics = computeMaturityMetrics(decisions)
    expect(metrics.totalDecisions).toBe(4)
    expect(metrics.approvalRequiredCount).toBe(2)
    expect(metrics.autoApprovableCount).toBe(1)
    expect(metrics.approvalRequiredRate).toBe(0.5)
    expect(metrics.autoApproveAdoptionRate).toBe(0.5)
  })

  it('returns zeros for empty array', () => {
    const metrics = computeMaturityMetrics([])
    expect(metrics.totalDecisions).toBe(0)
    expect(metrics.approvalRequiredRate).toBe(0)
    expect(metrics.autoApproveAdoptionRate).toBe(0)
  })

  it('returns zero adoption rate when no approvals needed', () => {
    const decisions = [makeGoverned({ action: 'auto_execute' })]
    const metrics = computeMaturityMetrics(decisions)
    expect(metrics.approvalRequiredCount).toBe(0)
    expect(metrics.autoApproveAdoptionRate).toBe(0)
  })
})

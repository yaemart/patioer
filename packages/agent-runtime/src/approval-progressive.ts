/**
 * Approval progressive mechanism — Phase 6 precursor.
 *
 * Two modes:
 *   - `approval_required` (default): all governed decisions with `requires_approval`
 *     must be approved by a human before execution.
 *   - `approval_informed`: safe decisions (within constitutional thresholds AND
 *     confidence > CONFIDENCE_THRESHOLD) are auto-executed and the seller is
 *     notified post-hoc with a 48h rollback window.
 *
 * The `autonomous` mode is reserved for Phase 6 and rejected at the API layer.
 */

import type { GovernedDecision, GovernedAction } from './decision-pipeline.js'
import type { ApprovalMode } from './ports.js'

export const AUTO_APPROVE_CONFIDENCE_THRESHOLD = 0.9

export interface AutoApproveResult {
  autoApprovable: boolean
  autoApproveReason: string | null
}

export function evaluateAutoApprovable<T>(
  governed: GovernedDecision<T>,
): AutoApproveResult {
  if (governed.action !== 'requires_approval') {
    return { autoApprovable: false, autoApproveReason: null }
  }

  if (governed.guard.degraded || governed.guard.businessGuardTriggered) {
    return {
      autoApprovable: false,
      autoApproveReason: null,
    }
  }

  if (governed.confidence >= AUTO_APPROVE_CONFIDENCE_THRESHOLD) {
    const detail = governed.guard.constitutionTriggered
      ? 'within constitutional safety net'
      : 'no constitutional trigger'
    return {
      autoApprovable: true,
      autoApproveReason: `Confidence ${(governed.confidence * 100).toFixed(0)}% ≥ ${AUTO_APPROVE_CONFIDENCE_THRESHOLD * 100}% threshold; ${detail}`,
    }
  }

  return { autoApprovable: false, autoApproveReason: null }
}

export function resolveEffectiveAction<T>(
  governed: GovernedDecision<T>,
  approvalMode: ApprovalMode,
  autoApprove: AutoApproveResult,
): GovernedAction {
  if (governed.action !== 'requires_approval') {
    return governed.action
  }

  if (approvalMode === 'approval_informed' && autoApprove.autoApprovable) {
    return 'auto_execute'
  }

  return 'requires_approval'
}

export interface ApprovalMaturityMetrics {
  totalDecisions: number
  approvalRequiredCount: number
  autoApprovableCount: number
  approvalRequiredRate: number
  autoApproveAdoptionRate: number
}

export function computeMaturityMetrics<T>(
  governed: GovernedDecision<T>[],
): ApprovalMaturityMetrics {
  const total = governed.length
  if (total === 0) {
    return {
      totalDecisions: 0,
      approvalRequiredCount: 0,
      autoApprovableCount: 0,
      approvalRequiredRate: 0,
      autoApproveAdoptionRate: 0,
    }
  }

  let approvalRequiredCount = 0
  let autoApprovableCount = 0

  for (const g of governed) {
    if (g.action === 'requires_approval') {
      approvalRequiredCount++
      const { autoApprovable } = evaluateAutoApprovable(g)
      if (autoApprovable) autoApprovableCount++
    }
  }

  return {
    totalDecisions: total,
    approvalRequiredCount,
    autoApprovableCount,
    approvalRequiredRate: approvalRequiredCount / total,
    autoApproveAdoptionRate: approvalRequiredCount > 0
      ? autoApprovableCount / approvalRequiredCount
      : 0,
  }
}

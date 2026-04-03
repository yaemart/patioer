export type BusinessGuardEffect = 'none' | 'require_approval' | 'block'

export interface BusinessGuard {
  effect: BusinessGuardEffect
  reason: string | null
}

export function noBusinessGuard(): BusinessGuard {
  return { effect: 'none', reason: null }
}

export function requireApprovalGuard(reason: string): BusinessGuard {
  return { effect: 'require_approval', reason }
}

export function blockGuard(reason: string): BusinessGuard {
  return { effect: 'block', reason }
}

export function guardRequiresApproval(baseRequiresApproval: boolean, guard: BusinessGuard): boolean {
  return baseRequiresApproval || guard.effect === 'require_approval'
}

export function guardBlocksExecution(guard: BusinessGuard): boolean {
  return guard.effect === 'block'
}

export function composeGuardedReason(baseReason: string, guard: BusinessGuard): string {
  if (!guard.reason) return baseReason
  return baseReason ? `${baseReason}; ${guard.reason}` : guard.reason
}

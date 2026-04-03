import type { SopRecord, SopResolutionContext, ResolvedSop } from './types.js'

/**
 * Resolve the single highest-priority active SOP for a given agent scope.
 *
 * Priority rules (higher wins):
 *   1. entity > platform > global  (narrower scope wins)
 *   2. time-windowed > no time window  (bounded SOPs are more intentional)
 *   3. same layer & same time-window → highest version wins
 *   4. narrow-layer goalContext fully overrides wider layer (no merging)
 *   5. expired SOPs (effectiveTo < now) are skipped → fall back to next priority
 */
export function resolveSop(
  sops: SopRecord[],
  ctx: SopResolutionContext,
): ResolvedSop | null {
  const now = ctx.now ?? new Date()

  const candidates = sops.filter((s) => {
    if (s.scope !== ctx.agentScope) return false
    if (s.status !== 'active') return false
    if (s.effectiveFrom && s.effectiveFrom > now) return false
    if (s.effectiveTo && s.effectiveTo < now) return false
    return true
  })

  if (candidates.length === 0) return null

  const scored = candidates.map((s) => ({
    sop: s,
    scopeScore: scopeScore(s, ctx),
    timeScore: timeScore(s),
  }))

  scored.sort((a, b) => {
    if (a.scopeScore !== b.scopeScore) return b.scopeScore - a.scopeScore
    if (a.timeScore !== b.timeScore) return b.timeScore - a.timeScore
    return b.sop.version - a.sop.version
  })

  const winner = scored[0]!
  return {
    sop: winner.sop,
    resolvedAt: now,
    resolutionPath: buildResolutionPath(winner.sop),
  }
}

function scopeScore(sop: SopRecord, ctx: SopResolutionContext): number {
  if (sop.entityId && sop.entityType && sop.platform) {
    if (
      sop.entityId === ctx.entityId &&
      sop.entityType === ctx.entityType &&
      sop.platform === ctx.platform
    ) {
      return 3
    }
    return -1
  }

  if (sop.platform && !sop.entityId) {
    if (sop.platform === ctx.platform) return 2
    return -1
  }

  if (!sop.platform && !sop.entityId) return 1

  return -1
}

function timeScore(sop: SopRecord): number {
  return (sop.effectiveFrom || sop.effectiveTo) ? 1 : 0
}

function buildResolutionPath(sop: SopRecord): string {
  const parts: string[] = [sop.scope]
  if (sop.platform) parts.push(sop.platform)
  if (sop.entityType) parts.push(sop.entityType)
  if (sop.entityId) parts.push(sop.entityId)
  parts.push(`v${sop.version}`)
  return parts.join('/')
}

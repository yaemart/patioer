export type InventoryLevelStatus = 'normal' | 'low' | 'out_of_stock'

/** Default matches `inventory_levels.safety_threshold` DB default (10). */
export const DEFAULT_SAFETY_THRESHOLD = 10

/** Min suggested restock before requesting `inventory.adjust` approval (Sprint 4 Day 7). */
export const DEFAULT_REPLENISH_APPROVAL_MIN_UNITS = 50

export function effectiveReplenishApprovalMinUnits(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return DEFAULT_REPLENISH_APPROVAL_MIN_UNITS
  return Math.max(1, Math.floor(raw))
}

export function effectiveSafetyThreshold(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return DEFAULT_SAFETY_THRESHOLD
  return Math.max(1, Math.floor(raw))
}

export function deriveInventoryStatus(
  quantity: number,
  safetyThreshold: number,
): InventoryLevelStatus {
  if (quantity <= 0) return 'out_of_stock'
  if (quantity < safetyThreshold) return 'low'
  return 'normal'
}

/** Rough restock suggestion for ticket copy (not a platform write). */
export function suggestedRestockUnits(quantity: number, safetyThreshold: number): number {
  const target = Math.max(safetyThreshold * 2, safetyThreshold + 1)
  return Math.max(0, target - quantity)
}

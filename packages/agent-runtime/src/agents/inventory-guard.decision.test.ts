import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REPLENISH_APPROVAL_MIN_UNITS,
  DEFAULT_SAFETY_THRESHOLD,
  deriveInventoryStatus,
  effectiveReplenishApprovalMinUnits,
  effectiveSafetyThreshold,
  suggestedRestockUnits,
} from './inventory-guard.decision.js'

describe('inventory-guard.decision', () => {
  it('effectiveSafetyThreshold defaults invalid to 10', () => {
    expect(effectiveSafetyThreshold(undefined)).toBe(DEFAULT_SAFETY_THRESHOLD)
    expect(effectiveSafetyThreshold(0)).toBe(DEFAULT_SAFETY_THRESHOLD)
    expect(effectiveSafetyThreshold(-1)).toBe(DEFAULT_SAFETY_THRESHOLD)
  })

  it('effectiveSafetyThreshold floors positive numbers', () => {
    expect(effectiveSafetyThreshold(12.7)).toBe(12)
  })

  it('deriveInventoryStatus: out_of_stock, low, normal', () => {
    expect(deriveInventoryStatus(0, 10)).toBe('out_of_stock')
    expect(deriveInventoryStatus(3, 10)).toBe('low')
    expect(deriveInventoryStatus(10, 10)).toBe('normal')
    expect(deriveInventoryStatus(11, 10)).toBe('normal')
  })

  it('suggestedRestockUnits is non-negative', () => {
    expect(suggestedRestockUnits(0, 10)).toBeGreaterThan(0)
    expect(suggestedRestockUnits(9, 10)).toBeGreaterThan(0)
  })

  it('effectiveReplenishApprovalMinUnits defaults sensibly', () => {
    expect(effectiveReplenishApprovalMinUnits(undefined)).toBe(DEFAULT_REPLENISH_APPROVAL_MIN_UNITS)
    expect(effectiveReplenishApprovalMinUnits(5)).toBe(5)
  })
})

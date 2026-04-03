import { describe, it, expect } from 'vitest'
import {
  priceOutcomeEvaluator,
  adsOutcomeEvaluator,
  inventoryOutcomeEvaluator,
  approvalOutcomeEvaluator,
  getEvaluator,
} from './outcome-tracker.js'

describe('OutcomeTracker evaluators (stubs)', () => {
  it('priceOutcomeEvaluator extracts price metrics and returns insufficient_data', async () => {
    const result = await priceOutcomeEvaluator.evaluate('dec-1', 'tenant-1', {
      productId: 'PROD-001',
      currentPrice: 20,
      proposedPrice: 18,
    })
    expect(result.verdict).toBe('insufficient_data')
    expect(result.scope).toBe('price-sentinel')
    expect(result.metrics.changePct).toBe(-10)
    expect(result.summary).toContain('PROD-001')
    expect(result.summary).toContain('[stub]')
  })

  it('adsOutcomeEvaluator extracts budget metrics', async () => {
    const result = await adsOutcomeEvaluator.evaluate('dec-3', 'tenant-1', {
      campaignId: 'CAMP-001',
      currentDailyBudget: 50,
      proposedDailyBudget: 75,
      action: 'increase',
    })
    expect(result.verdict).toBe('insufficient_data')
    expect(result.metrics.budgetBefore).toBe(50)
    expect(result.metrics.budgetAfter).toBe(75)
  })

  it('inventoryOutcomeEvaluator extracts restock metrics', async () => {
    const result = await inventoryOutcomeEvaluator.evaluate('dec-5', 'tenant-1', {
      productId: 'SKU-001',
      restockUnits: 500,
      action: 'restock',
    })
    expect(result.verdict).toBe('insufficient_data')
    expect(result.scope).toBe('inventory-guard')
    expect(result.metrics.restockUnits).toBe(500)
  })

  it('approvalOutcomeEvaluator extracts resolution time', async () => {
    const result = await approvalOutcomeEvaluator.evaluate('dec-6', 'tenant-1', {
      status: 'approved',
      guard: 'price-change',
      resolvedWithinMs: 3600000,
    })
    expect(result.verdict).toBe('insufficient_data')
    expect(result.metrics.resolvedWithinHours).toBe(1)
  })

  it('evaluators have correct delay days', () => {
    expect(priceOutcomeEvaluator.evaluateDelayDays).toBe(7)
    expect(adsOutcomeEvaluator.evaluateDelayDays).toBe(7)
    expect(inventoryOutcomeEvaluator.evaluateDelayDays).toBe(14)
    expect(approvalOutcomeEvaluator.evaluateDelayDays).toBe(7)
  })

  it('getEvaluator returns correct evaluator by scope', () => {
    expect(getEvaluator('price-sentinel')).toBe(priceOutcomeEvaluator)
    expect(getEvaluator('ads-optimizer')).toBe(adsOutcomeEvaluator)
    expect(getEvaluator('inventory-guard')).toBe(inventoryOutcomeEvaluator)
    expect(getEvaluator('approval')).toBe(approvalOutcomeEvaluator)
    expect(getEvaluator('unknown')).toBeUndefined()
  })
})

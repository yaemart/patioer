import { describe, it, expect } from 'vitest'
import {
  resolveOperatingMode,
  getGoalContextForMode,
  getAgentGoalContext,
  isValidOperatingMode,
  VALID_OPERATING_MODES,
} from './goal-context-mapper.js'

describe('resolveOperatingMode', () => {
  it('returns daily when no goals', () => {
    expect(resolveOperatingMode([])).toBe('daily')
  })

  it('returns daily when all goals inactive', () => {
    expect(resolveOperatingMode([
      { category: 'margin', isActive: false, name: 'Protect Profit' },
    ])).toBe('daily')
  })

  it('detects clearance from name', () => {
    expect(resolveOperatingMode([
      { category: 'revenue', isActive: true, name: 'Q4 Clearance Sale' },
    ])).toBe('clearance')
  })

  it('detects launch from name', () => {
    expect(resolveOperatingMode([
      { category: 'revenue', isActive: true, name: 'New Product Launch 2026' },
    ])).toBe('launch')
  })

  it('detects launch from Chinese name', () => {
    expect(resolveOperatingMode([
      { category: 'revenue', isActive: true, name: '新品上架计划' },
    ])).toBe('launch')
  })

  it('detects profit-first from name', () => {
    expect(resolveOperatingMode([
      { category: 'custom', isActive: true, name: 'Profit Maximization' },
    ])).toBe('profit-first')
  })

  it('detects profit-first from margin category', () => {
    expect(resolveOperatingMode([
      { category: 'margin', isActive: true, name: 'Q2 Target' },
    ])).toBe('profit-first')
  })

  it('detects scale from name', () => {
    expect(resolveOperatingMode([
      { category: 'revenue', isActive: true, name: 'Scale to $1M ARR' },
    ])).toBe('scale')
  })

  it('detects scale from revenue-only category', () => {
    expect(resolveOperatingMode([
      { category: 'revenue', isActive: true, name: 'Q3 revenue push' },
    ])).toBe('scale')
  })

  it('falls back to daily for unrecognized', () => {
    expect(resolveOperatingMode([
      { category: 'customer', isActive: true, name: 'Improve NPS' },
    ])).toBe('daily')
  })
})

describe('getGoalContextForMode', () => {
  it('returns all 3 agent sections for each mode', () => {
    for (const mode of VALID_OPERATING_MODES) {
      const ctx = getGoalContextForMode(mode)
      expect(ctx.priceSentinel).toBeDefined()
      expect(ctx.adsOptimizer).toBeDefined()
      expect(ctx.inventoryGuard).toBeDefined()
    }
  })

  it('profit-first tightens margins', () => {
    const ctx = getGoalContextForMode('profit-first')
    expect(ctx.priceSentinel.minMarginPercent).toBeGreaterThanOrEqual(20)
    expect(ctx.adsOptimizer.budgetStrategy).toBe('conservative')
  })

  it('launch relaxes margins', () => {
    const ctx = getGoalContextForMode('launch')
    expect(ctx.priceSentinel.minMarginPercent).toBeLessThanOrEqual(10)
    expect(ctx.adsOptimizer.budgetStrategy).toBe('aggressive')
    expect(ctx.adsOptimizer.allowNewCampaigns).toBe(true)
  })

  it('clearance stops ads and replenishment', () => {
    const ctx = getGoalContextForMode('clearance')
    expect(ctx.adsOptimizer.budgetStrategy).toBe('pause')
    expect(ctx.inventoryGuard.replenishmentEnabled).toBe(false)
    expect(ctx.priceSentinel.minMarginPercent).toBeLessThan(0)
  })
})

describe('getAgentGoalContext', () => {
  it('returns price-sentinel context for price-sentinel scope', () => {
    const ctx = getAgentGoalContext('price-sentinel', 'launch')
    expect(ctx).toHaveProperty('pricingStrategy', 'aggressive-match')
    expect(ctx).toHaveProperty('minMarginPercent')
  })

  it('returns ads-optimizer context', () => {
    const ctx = getAgentGoalContext('ads-optimizer', 'profit-first')
    expect(ctx).toHaveProperty('budgetStrategy', 'conservative')
  })

  it('returns inventory-guard context', () => {
    const ctx = getAgentGoalContext('inventory-guard', 'clearance')
    expect(ctx).toHaveProperty('replenishmentEnabled', false)
  })

  it('returns empty for unknown scope', () => {
    expect(getAgentGoalContext('unknown-agent', 'daily')).toEqual({})
  })
})

describe('isValidOperatingMode', () => {
  it('validates known modes', () => {
    expect(isValidOperatingMode('profit-first')).toBe(true)
    expect(isValidOperatingMode('launch')).toBe(true)
    expect(isValidOperatingMode('daily')).toBe(true)
  })

  it('rejects unknown modes', () => {
    expect(isValidOperatingMode('turbo')).toBe(false)
    expect(isValidOperatingMode('')).toBe(false)
  })
})

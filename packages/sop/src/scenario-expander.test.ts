import { describe, it, expect } from 'vitest'
import { expandScenario, _mergeGoalContext } from './scenario-expander.js'
import { getTemplate, ALL_SCENARIO_TEMPLATES, SCENARIOS, TEMPLATE_SCOPES } from './scenario-templates.js'

describe('scenario-templates', () => {
  it('has exactly 12 templates (4 scenarios × 3 scopes)', () => {
    expect(ALL_SCENARIO_TEMPLATES).toHaveLength(12)
  })

  it('covers all scenario × scope combinations', () => {
    for (const scenario of SCENARIOS) {
      for (const scope of TEMPLATE_SCOPES) {
        const t = getTemplate(scenario, scope)
        expect(t, `Missing template: ${scenario}/${scope}`).not.toBeNull()
        expect(t!.defaultSopText.length).toBeGreaterThan(10)
        expect(Object.keys(t!.defaultGoalContext).length).toBeGreaterThan(0)
      }
    }
  })

  it('locked fields are not in editable fields', () => {
    for (const t of ALL_SCENARIO_TEMPLATES) {
      const lockedSet = new Set(t.lockedFields)
      for (const editable of t.editableFields) {
        expect(lockedSet.has(editable), `${t.scenario}/${t.scope}: "${editable}" is both locked and editable`).toBe(false)
      }
    }
  })
})

describe('_mergeGoalContext', () => {
  it('applies editable overrides', () => {
    const template = getTemplate('launch', 'price-sentinel')!
    const merged = _mergeGoalContext(template, { minMarginPercent: 8 })
    expect(merged.minMarginPercent).toBe(8)
  })

  it('rejects locked field overrides', () => {
    const template = getTemplate('launch', 'price-sentinel')!
    const merged = _mergeGoalContext(template, { pricingStrategy: 'defensive' })
    expect(merged.pricingStrategy).toBe('aggressive-match')
  })

  it('rejects unknown field overrides when editableFields is non-empty', () => {
    const template = getTemplate('launch', 'price-sentinel')!
    const merged = _mergeGoalContext(template, { unknownField: 'xyz' })
    expect(merged).not.toHaveProperty('unknownField')
  })

  it('returns defaults when no overrides', () => {
    const template = getTemplate('daily', 'ads-optimizer')!
    const merged = _mergeGoalContext(template, undefined)
    expect(merged).toEqual(template.defaultGoalContext)
  })
})

describe('expandScenario', () => {
  it('expands launch scenario into 3 SOPs', async () => {
    const result = await expandScenario({ scenario: 'launch' })

    expect(result.scenario).toBe('launch')
    expect(result.expandedSops).toHaveLength(3)

    const scopes = result.expandedSops.map((s) => s.scope).sort()
    expect(scopes).toEqual(['ads-optimizer', 'inventory-guard', 'price-sentinel'])
  })

  it('carries goalContext from template through to expanded SOP', async () => {
    const result = await expandScenario({ scenario: 'defend' })

    const priceSop = result.expandedSops.find((s) => s.scope === 'price-sentinel')!
    expect(priceSop.goalContext.pricingStrategy).toBe('defensive')
    expect(priceSop.goalContext.minMarginPercent).toBe(15)
  })

  it('applies tenant overrides and respects locked fields', async () => {
    const result = await expandScenario({
      scenario: 'launch',
      tenantOverrides: {
        'price-sentinel': {
          minMarginPercent: 8,
          pricingStrategy: 'defensive',
        },
      },
    })

    const priceSop = result.expandedSops.find((s) => s.scope === 'price-sentinel')!
    expect(priceSop.goalContext.minMarginPercent).toBe(8)
    expect(priceSop.goalContext.pricingStrategy).toBe('aggressive-match')
  })

  it('returns empty for unknown scenario', async () => {
    const result = await expandScenario({ scenario: 'nonexistent' })
    expect(result.expandedSops).toHaveLength(0)
  })

  it('clearance scenario has drain-only inventory strategy', async () => {
    const result = await expandScenario({ scenario: 'clearance' })

    const invSop = result.expandedSops.find((s) => s.scope === 'inventory-guard')!
    expect(invSop.goalContext.inventoryStrategy).toBe('drain-only')
    expect(invSop.goalContext.safetyThreshold).toBe(0)
  })

  it('clearance ads uses brand-only strategy', async () => {
    const result = await expandScenario({ scenario: 'clearance' })

    const adsSop = result.expandedSops.find((s) => s.scope === 'ads-optimizer')!
    expect(adsSop.goalContext.adsStrategy).toBe('brand-only')
    expect(adsSop.goalContext.maxDailyBudgetUsd).toBe(10)
  })

  it('includes seller customisation note in sopText when overrides differ', async () => {
    const result = await expandScenario({
      scenario: 'daily',
      tenantOverrides: {
        'ads-optimizer': { targetRoas: 5 },
      },
    })

    const adsSop = result.expandedSops.find((s) => s.scope === 'ads-optimizer')!
    expect(adsSop.sopText).toContain('Seller customisation')
    expect(adsSop.sopText).toContain('targetRoas')
  })

  it('all 4 scenarios expand correctly', async () => {
    for (const scenario of SCENARIOS) {
      const result = await expandScenario({ scenario })
      expect(result.expandedSops).toHaveLength(3)
      for (const sop of result.expandedSops) {
        expect(sop.scenario).toBe(scenario)
        expect(sop.sopText.length).toBeGreaterThan(0)
        expect(Object.keys(sop.goalContext).length).toBeGreaterThan(0)
      }
    }
  })
})

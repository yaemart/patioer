import { describe, expect, it } from 'vitest'
import { buildSreResponseSuggestion } from './sre-response-suggestion.js'

describe('buildSreResponseSuggestion', () => {
  it('returns runbook for ElectroOsHarnessErrorRateHigh', () => {
    const s = buildSreResponseSuggestion('ElectroOsHarnessErrorRateHigh')
    expect(s.severity).toBe('critical')
    expect(s.runbook).toContain('harness-error-rate-high')
    expect(s.suggestedAction).toBeTruthy()
  })

  it('returns runbook for ElectroOsDbPoolUsageHigh', () => {
    const s = buildSreResponseSuggestion('ElectroOsDbPoolUsageHigh')
    expect(s.severity).toBe('critical')
    expect(s.runbook).toContain('db-pool-usage-high')
  })

  it('returns generic suggestion for unknown alert', () => {
    const s = buildSreResponseSuggestion('SomeRandomAlert')
    expect(s.severity).toBe('unknown')
    expect(s.runbook).toContain('generic-alert')
    expect(s.suggestedAction).toBeTruthy()
  })
})

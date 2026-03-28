import { describe, expect, it } from 'vitest'
import { DEVOS_FULL_SEED, DEVOS_MONTHLY_BUDGET_USD, buildDevOsFullSeed } from './devos-full-seed.js'
import { DEVOS_AGENT_IDS } from './devos-org-chart.js'

describe('DEVOS_FULL_SEED', () => {
  it('contains exactly 12 agents matching org chart', () => {
    expect(DEVOS_FULL_SEED).toHaveLength(12)
    const seedIds = DEVOS_FULL_SEED.map((a) => a.id)
    for (const expected of DEVOS_AGENT_IDS) {
      expect(seedIds).toContain(expected)
    }
  })

  it('monthly budget totals $720', () => {
    expect(DEVOS_MONTHLY_BUDGET_USD).toBe(720)
  })

  it('every agent has a positive budget and valid trigger', () => {
    for (const agent of DEVOS_FULL_SEED) {
      expect(agent.monthlyBudgetUsd).toBeGreaterThan(0)
      expect(agent.model).toBeTruthy()
      expect(agent.trigger).toBeTruthy()
    }
  })

  it('QA Agent minCoverage is 80', () => {
    const qa = DEVOS_FULL_SEED.find((a) => a.id === 'qa-agent')
    expect(qa?.config.minCoverage).toBe(80)
  })

  it('DevOps Agent requires human approval for production', () => {
    const devops = DEVOS_FULL_SEED.find((a) => a.id === 'devops-agent')
    expect(devops?.config.requiresHumanApprovalForProd).toBe(true)
  })
})

describe('buildDevOsFullSeed', () => {
  it('returns valid seed JSON structure', () => {
    const seed = buildDevOsFullSeed()
    expect(seed.schema).toBe('devos-full-seed/v1')
    expect(seed.version).toBe('4.0.0')
    expect(seed.totalMonthlyBudgetUsd).toBe(720)
    expect(seed.agents).toHaveLength(12)
    expect(seed.generatedAt).toBeTruthy()
  })
})

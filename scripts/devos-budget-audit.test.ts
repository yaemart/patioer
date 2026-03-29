import { describe, it, expect } from 'vitest'
import { auditDevOsBudget } from './devos-budget-audit.js'

describe('DevOS budget audit — AC-P4-14', () => {
  it('all 12 DevOS agents are present', () => {
    const result = auditDevOsBudget()
    expect(result.totalAgents).toBe(12)
    expect(result.allAgentsPresent).toBe(true)
  })

  it('total monthly budget ≤ $720', () => {
    const result = auditDevOsBudget()
    expect(result.totalMonthlyBudgetUsd).toBeLessThanOrEqual(720)
    expect(result.withinLimit).toBe(true)
  })

  it('total monthly budget is exactly $720', () => {
    const result = auditDevOsBudget()
    expect(result.totalMonthlyBudgetUsd).toBe(720)
  })

  it('each agent has a positive budget', () => {
    const result = auditDevOsBudget()
    for (const agent of result.perAgentBudgets) {
      expect(agent.monthlyBudgetUsd).toBeGreaterThan(0)
    }
  })

  it('audit passes overall', () => {
    const result = auditDevOsBudget()
    expect(result.pass).toBe(true)
  })
})

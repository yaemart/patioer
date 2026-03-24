import { describe, expect, it } from 'vitest'
import {
  checkAlertRulesCatalogComplete,
  checkDbIsolationLogic,
  checkHarnessToDevOsFlow,
  checkTicketProtocolIntegrity,
  runSprint5AcceptanceChecklist,
} from './sprint5-acceptance-checklist.js'

describe('sprint5-acceptance-checklist', () => {
  it('AC-1 ticket protocol integrity passes', () => {
    const result = checkTicketProtocolIntegrity()
    expect(result.passed).toBe(true)
    expect(result.id).toBe('AC-1')
  })

  it('AC-2 harness to DevOS flow passes', () => {
    const result = checkHarnessToDevOsFlow()
    expect(result.passed).toBe(true)
    expect(result.id).toBe('AC-2')
  })

  it('AC-3 alert rules catalog complete passes', () => {
    const result = checkAlertRulesCatalogComplete()
    expect(result.passed).toBe(true)
    expect(result.id).toBe('AC-3')
    expect(result.detail).toBeUndefined()
  })

  it('AC-4 DB isolation logic passes', () => {
    const result = checkDbIsolationLogic()
    expect(result.passed).toBe(true)
    expect(result.id).toBe('AC-4')
  })

  it('runSprint5AcceptanceChecklist returns allPassed true', () => {
    const result = runSprint5AcceptanceChecklist()
    expect(result.allPassed).toBe(true)
    expect(result.checks).toHaveLength(4)
    for (const check of result.checks) {
      expect(check.passed).toBe(true)
    }
  })
})

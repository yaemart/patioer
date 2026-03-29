import { describe, expect, it } from 'vitest'
import { LoopError } from './loop-error.js'

describe('LoopError', () => {
  it('coverage_below_80 message contains coverage percentage', () => {
    const e = new LoopError('coverage_below_80', { stage: 6, coverage: 72 })
    expect(e.message).toContain('72%')
    expect(e.message).toContain('Stage 06')
    expect(e.message).toContain('80%')
    expect(e.code).toBe('coverage_below_80')
    expect(e.name).toBe('LoopError')
  })

  it('security_issues message contains vulnerability count', () => {
    const e = new LoopError('security_issues', { stage: 6, vulnerabilities: 3 })
    expect(e.message).toContain('3')
    expect(e.code).toBe('security_issues')
  })

  it('approval_rejected includes reason', () => {
    const e = new LoopError('approval_rejected', { stage: 7, details: 'scope too large' })
    expect(e.message).toContain('scope too large')
  })

  it('all LoopError codes are handled (exhaustive)', () => {
    const codes = [
      'coverage_below_80', 'security_issues', 'code_execution_failed', 'deployment_failed',
      'approval_timeout', 'approval_rejected', 'health_check_failed',
      'rollback_triggered', 'task_graph_cycle', 'agent_budget_exceeded',
      'stage_timeout',
    ] as const
    for (const code of codes) {
      const e = new LoopError(code)
      expect(e.message).toBeTruthy()
    }
  })
})

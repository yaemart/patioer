import { describe, expect, it, beforeEach } from 'vitest'
import {
  OnboardingMachine,
  createInMemoryStore,
  createInitialState,
  advanceStep,
  skipStep,
  isStepSkippable,
  validateStep,
  getStepName,
} from './onboarding-machine.js'
import type { OnboardingState, OnboardingStep } from './onboarding.types.js'
import type { StepInput } from './onboarding-machine.js'

function freshState(): OnboardingState {
  return createInitialState()
}

describe('onboarding-machine pure functions', () => {
  describe('createInitialState', () => {
    it('starts at step 1 with empty data', () => {
      const s = freshState()
      expect(s.currentStep).toBe(1)
      expect(s.stepData).toEqual({})
      expect(s.oauthStatus).toEqual({})
      expect(s.healthCheckPassed).toBe(false)
      expect(s.startedAt).toBeInstanceOf(Date)
      expect(s.completedAt).toBeNull()
    })
  })

  describe('isStepSkippable', () => {
    it('allows skipping step 4 (platform_oauth) and 6 (governance_prefs)', () => {
      expect(isStepSkippable(4)).toBe(true)
      expect(isStepSkippable(6)).toBe(true)
    })
    it('disallows skipping required steps', () => {
      expect(isStepSkippable(1)).toBe(false)
      expect(isStepSkippable(2)).toBe(false)
      expect(isStepSkippable(3)).toBe(false)
      expect(isStepSkippable(5)).toBe(false)
      expect(isStepSkippable(7)).toBe(false)
    })
  })

  describe('getStepName', () => {
    it('returns human-readable names', () => {
      expect(getStepName(1)).toBe('register')
      expect(getStepName(7)).toBe('health_check')
    })
  })

  describe('validateStep', () => {
    it('step 1 always passes', () => {
      expect(validateStep(1, {}, freshState())).toBeNull()
    })

    it('step 2 requires a valid plan', () => {
      expect(validateStep(2, {}, freshState())).toBe('Plan selection is required')
      expect(validateStep(2, { plan: 'bad' }, freshState())).toMatch(/Invalid plan/)
      expect(validateStep(2, { plan: 'growth' }, freshState())).toBeNull()
    })

    it('step 3 requires company name', () => {
      expect(validateStep(3, {}, freshState())).toBe('Company name is required')
      expect(validateStep(3, { company: { name: '' } }, freshState())).toBe('Company name is required')
      expect(validateStep(3, { company: { name: 'Acme' } }, freshState())).toBeNull()
    })

    it('step 4 requires at least one platform', () => {
      expect(validateStep(4, {}, freshState())).toBe('At least one platform is required')
      expect(validateStep(4, { platforms: [] }, freshState())).toBe('At least one platform is required')
      expect(validateStep(4, { platforms: ['invalid'] }, freshState())).toMatch(/Unsupported platform/)
      expect(validateStep(4, { platforms: ['shopify'] }, freshState())).toBeNull()
    })

    it('step 5 requires agent config', () => {
      expect(validateStep(5, {}, freshState())).toBe('At least one agent must be enabled')
      expect(validateStep(5, { agentConfig: { enabledAgents: ['product-scout'] } }, freshState())).toBeNull()
    })

    it('step 6 requires governance prefs', () => {
      expect(validateStep(6, {}, freshState())).toBe('Governance preferences are required')
      expect(validateStep(6, { governancePrefs: { approvalThreshold: 150, humanInLoopAgents: [] } }, freshState())).toMatch(/between 0 and 100/)
      expect(validateStep(6, { governancePrefs: { approvalThreshold: 15, humanInLoopAgents: [] } }, freshState())).toBeNull()
    })

    it('step 7 requires passing health check', () => {
      expect(validateStep(7, {}, freshState())).toBe('Health check result is required')
      expect(validateStep(7, { healthCheckResult: { passed: false } }, freshState())).toBe('Health check did not pass')
      expect(validateStep(7, { healthCheckResult: { passed: true } }, freshState())).toBeNull()
    })
  })

  describe('advanceStep', () => {
    it('advances from step 1 to step 2', () => {
      const s = freshState()
      const result = advanceStep(s, 1, {})
      expect(result.success).toBe(true)
      expect(s.currentStep).toBe(2)
    })

    it('rejects out-of-order step', () => {
      const s = freshState()
      const result = advanceStep(s, 3, { company: { name: 'X' } })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Expected step 1/)
    })

    it('rejects if already completed', () => {
      const s = freshState()
      s.completedAt = new Date()
      const result = advanceStep(s, 1, {})
      expect(result.success).toBe(false)
      expect(result.error).toBe('Onboarding already completed')
    })

    it('rejects step with validation error', () => {
      const s = freshState()
      s.currentStep = 2
      const result = advanceStep(s, 2, { plan: 'bad' })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Invalid plan/)
      expect(s.currentStep).toBe(2)
    })

    it('stores stepData and oauth results', () => {
      const s = freshState()
      s.currentStep = 4
      const result = advanceStep(s, 4, {
        platforms: ['shopify'],
        oauthResults: { shopify: 'success' },
      })
      expect(result.success).toBe(true)
      expect(s.stepData[4]).toBeDefined()
      expect(s.oauthStatus.shopify).toBe('success')
      expect(s.currentStep).toBe(5)
    })

    it('marks completion at step 7', () => {
      const s = freshState()
      s.currentStep = 7
      const result = advanceStep(s, 7, { healthCheckResult: { passed: true } })
      expect(result.success).toBe(true)
      expect(s.healthCheckPassed).toBe(true)
      expect(s.completedAt).toBeInstanceOf(Date)
    })
  })

  describe('skipStep', () => {
    it('skips step 4 (platform_oauth)', () => {
      const s = freshState()
      s.currentStep = 4
      const result = skipStep(s, 4)
      expect(result.success).toBe(true)
      expect(s.currentStep).toBe(5)
      expect(s.stepData[4]).toEqual({ skipped: true })
    })

    it('skips step 6 (governance_prefs)', () => {
      const s = freshState()
      s.currentStep = 6
      const result = skipStep(s, 6)
      expect(result.success).toBe(true)
      expect(s.currentStep).toBe(7)
    })

    it('rejects skip for required steps', () => {
      const s = freshState()
      s.currentStep = 2
      const result = skipStep(s, 2)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/cannot be skipped/)
    })

    it('rejects skip out-of-order', () => {
      const s = freshState()
      const result = skipStep(s, 4)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Expected step 1/)
    })

    it('rejects skip if completed', () => {
      const s = freshState()
      s.currentStep = 4
      s.completedAt = new Date()
      const result = skipStep(s, 4)
      expect(result.success).toBe(false)
    })
  })
})

describe('OnboardingMachine (with store)', () => {
  let machine: OnboardingMachine

  beforeEach(() => {
    machine = new OnboardingMachine(createInMemoryStore())
  })

  it('getOrCreate returns a fresh state for a new tenant', async () => {
    const state = await machine.getOrCreate('t-1')
    expect(state.currentStep).toBe(1)
  })

  it('getOrCreate returns existing state on second call', async () => {
    const s1 = await machine.getOrCreate('t-2')
    s1.currentStep = 3
    const s2 = await machine.getOrCreate('t-2')
    expect(s2.currentStep).toBe(3)
  })

  it('advance persists state on success', async () => {
    await machine.advance('t-3', 1, {})
    const state = await machine.getOrCreate('t-3')
    expect(state.currentStep).toBe(2)
  })

  it('advance does not persist on failure', async () => {
    await machine.advance('t-4', 1, {})
    const result = await machine.advance('t-4', 2, { plan: 'invalid' })
    expect(result.success).toBe(false)
    const state = await machine.getOrCreate('t-4')
    expect(state.currentStep).toBe(2)
  })

  it('skip persists state on success', async () => {
    await machine.advance('t-5', 1, {})
    await machine.advance('t-5', 2, { plan: 'starter' })
    await machine.advance('t-5', 3, { company: { name: 'Test' } })
    const result = await machine.skip('t-5', 4)
    expect(result.success).toBe(true)
    const state = await machine.getOrCreate('t-5')
    expect(state.currentStep).toBe(5)
  })

  it('full 7-step flow succeeds', async () => {
    const tid = 't-full'
    const steps: [OnboardingStep, StepInput][] = [
      [1, {}],
      [2, { plan: 'growth' }],
      [3, { company: { name: 'FullCorp', industry: 'retail' } }],
      [4, { platforms: ['shopify', 'amazon'], oauthResults: { shopify: 'success', amazon: 'success' } }],
      [5, { agentConfig: { enabledAgents: ['product-scout', 'price-sentinel'], budgetLimitUsd: 500 } }],
      [6, { governancePrefs: { approvalThreshold: 15, humanInLoopAgents: ['price-sentinel'] } }],
      [7, { healthCheckResult: { passed: true, details: { platformsUp: 2, agentsReady: 2 } } }],
    ]

    for (const [step, input] of steps) {
      const result = await machine.advance(tid, step, input)
      expect(result.success).toBe(true)
    }

    const final = await machine.getOrCreate(tid)
    expect(final.completedAt).toBeInstanceOf(Date)
    expect(final.healthCheckPassed).toBe(true)
    expect(final.oauthStatus).toEqual({ shopify: 'success', amazon: 'success' })
  })

  it('full flow with skips succeeds', async () => {
    const tid = 't-skip'
    await machine.advance(tid, 1, {})
    await machine.advance(tid, 2, { plan: 'starter' })
    await machine.advance(tid, 3, { company: { name: 'SkipCorp' } })
    await machine.skip(tid, 4)
    await machine.advance(tid, 5, { agentConfig: { enabledAgents: ['product-scout'] } })
    await machine.skip(tid, 6)
    const result = await machine.advance(tid, 7, { healthCheckResult: { passed: true } })
    expect(result.success).toBe(true)

    const final = await machine.getOrCreate(tid)
    expect(final.completedAt).toBeInstanceOf(Date)
    expect(final.stepData[4]).toEqual({ skipped: true })
    expect(final.stepData[6]).toEqual({ skipped: true })
  })
})

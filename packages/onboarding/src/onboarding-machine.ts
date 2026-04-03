import type { OnboardingStep, OnboardingState, OnboardingStepResult, OAuthStatus } from './onboarding.types.js'
import { ONBOARDING_STEP_NAMES } from './onboarding.types.js'

const MAX_STEP: OnboardingStep = 7

export interface OnboardingStore {
  getState(tenantId: string): Promise<OnboardingState | null>
  saveState(tenantId: string, state: OnboardingState): Promise<void>
}

export interface StepInput {
  plan?: string
  company?: { name: string; industry?: string; website?: string }
  platforms?: string[]
  oauthResults?: Record<string, OAuthStatus>
  agentConfig?: { enabledAgents: string[]; budgetLimitUsd?: number }
  governancePrefs?: { approvalThreshold: number; humanInLoopAgents: string[] }
  healthCheckResult?: { passed: boolean; details?: Record<string, unknown> }
}

export type StepValidator = (input: StepInput, state: OnboardingState) => string | null

const SKIPPABLE_STEPS: Set<OnboardingStep> = new Set([4, 6])

const VALID_PLANS = ['starter', 'growth', 'scale'] as const

function validateSelectPlan(input: StepInput): string | null {
  if (!input.plan) return 'Plan selection is required'
  if (!(VALID_PLANS as readonly string[]).includes(input.plan)) return `Invalid plan: ${input.plan}`
  return null
}

function validateCompanyInfo(input: StepInput): string | null {
  if (!input.company?.name) return 'Company name is required'
  if (input.company.name.length > 200) return 'Company name too long'
  return null
}

function validatePlatformOauth(input: StepInput): string | null {
  if (!input.platforms || input.platforms.length === 0) return 'At least one platform is required'
  const allowed = ['shopify', 'amazon', 'tiktok', 'shopee', 'walmart', 'wayfair']
  for (const p of input.platforms) {
    if (!allowed.includes(p)) return `Unsupported platform: ${p}`
  }
  return null
}

function validateAgentConfig(input: StepInput): string | null {
  if (!input.agentConfig?.enabledAgents || input.agentConfig.enabledAgents.length === 0) {
    return 'At least one agent must be enabled'
  }
  return null
}

function validateGovernancePrefs(input: StepInput): string | null {
  if (!input.governancePrefs) return 'Governance preferences are required'
  if (input.governancePrefs.approvalThreshold < 0 || input.governancePrefs.approvalThreshold > 100) {
    return 'Approval threshold must be between 0 and 100'
  }
  return null
}

function validateHealthCheck(input: StepInput): string | null {
  if (!input.healthCheckResult) return 'Health check result is required'
  if (!input.healthCheckResult.passed) return 'Health check did not pass'
  return null
}

const STEP_VALIDATORS: Record<OnboardingStep, StepValidator> = {
  1: () => null,
  2: validateSelectPlan,
  3: validateCompanyInfo,
  4: validatePlatformOauth,
  5: validateAgentConfig,
  6: validateGovernancePrefs,
  7: validateHealthCheck,
}

export function createInitialState(): OnboardingState {
  return {
    currentStep: 1,
    stepData: {},
    oauthStatus: {},
    healthCheckPassed: false,
    startedAt: new Date(),
    completedAt: null,
  }
}

export function isStepSkippable(step: OnboardingStep): boolean {
  return SKIPPABLE_STEPS.has(step)
}

export function getStepName(step: OnboardingStep): string {
  return ONBOARDING_STEP_NAMES[step]
}

export function validateStep(step: OnboardingStep, input: StepInput, state: OnboardingState): string | null {
  const validator = STEP_VALIDATORS[step]
  return validator(input, state)
}

export function advanceStep(state: OnboardingState, step: OnboardingStep, input: StepInput): OnboardingStepResult {
  if (step !== state.currentStep) {
    return { step, success: false, error: `Expected step ${state.currentStep}, got ${step}` }
  }

  if (state.completedAt) {
    return { step, success: false, error: 'Onboarding already completed' }
  }

  const validationError = validateStep(step, input, state)
  if (validationError) {
    return { step, success: false, error: validationError }
  }

  state.stepData[step] = input
  if (input.oauthResults) {
    state.oauthStatus = { ...state.oauthStatus, ...input.oauthResults }
  }
  if (step === 7 && input.healthCheckResult?.passed) {
    state.healthCheckPassed = true
  }

  if (step < MAX_STEP) {
    state.currentStep = (step + 1) as OnboardingStep
  } else {
    state.completedAt = new Date()
  }

  return { step, success: true, data: input }
}

export function skipStep(state: OnboardingState, step: OnboardingStep): OnboardingStepResult {
  if (step !== state.currentStep) {
    return { step, success: false, error: `Expected step ${state.currentStep}, got ${step}` }
  }

  if (!isStepSkippable(step)) {
    return { step, success: false, error: `Step ${step} (${getStepName(step)}) cannot be skipped` }
  }

  if (state.completedAt) {
    return { step, success: false, error: 'Onboarding already completed' }
  }

  state.stepData[step] = { skipped: true }
  state.currentStep = (step + 1) as OnboardingStep

  return { step, success: true, data: { skipped: true } }
}

export class OnboardingMachine {
  constructor(private store: OnboardingStore) {}

  async getOrCreate(tenantId: string): Promise<OnboardingState> {
    const existing = await this.store.getState(tenantId)
    if (existing) return existing
    const initial = createInitialState()
    await this.store.saveState(tenantId, initial)
    return initial
  }

  async advance(tenantId: string, step: OnboardingStep, input: StepInput): Promise<OnboardingStepResult> {
    const state = await this.getOrCreate(tenantId)
    const result = advanceStep(state, step, input)
    if (result.success) {
      await this.store.saveState(tenantId, state)
    }
    return result
  }

  async skip(tenantId: string, step: OnboardingStep): Promise<OnboardingStepResult> {
    const state = await this.getOrCreate(tenantId)
    const result = skipStep(state, step)
    if (result.success) {
      await this.store.saveState(tenantId, state)
    }
    return result
  }
}

export function createInMemoryStore(): OnboardingStore {
  const data = new Map<string, OnboardingState>()
  return {
    async getState(tenantId) { return data.get(tenantId) ?? null },
    async saveState(tenantId, state) { data.set(tenantId, state) },
  }
}

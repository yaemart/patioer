export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6 | 7

export const ONBOARDING_STEP_NAMES: Record<OnboardingStep, string> = {
  1: 'register',
  2: 'select_plan',
  3: 'company_info',
  4: 'platform_oauth',
  5: 'agent_config',
  6: 'governance_prefs',
  7: 'health_check',
} as const

export type OAuthStatus = 'pending' | 'success' | 'failed' | 'skipped'

export interface OnboardingState {
  currentStep: OnboardingStep
  stepData: Record<number, unknown>
  oauthStatus: Record<string, OAuthStatus>
  healthCheckPassed: boolean
  startedAt: Date | null
  completedAt: Date | null
}

export interface OnboardingStepResult {
  step: OnboardingStep
  success: boolean
  error?: string
  data?: unknown
}

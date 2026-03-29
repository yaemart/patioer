export type {
  OnboardingStep,
  OAuthStatus,
  OnboardingState,
  OnboardingStepResult,
} from './onboarding.types.js'
export { ONBOARDING_STEP_NAMES } from './onboarding.types.js'

export type { OnboardingStore, StepInput, StepValidator } from './onboarding-machine.js'
export {
  OnboardingMachine,
  createInMemoryStore,
  createInitialState,
  advanceStep,
  skipStep,
  isStepSkippable,
  validateStep,
  getStepName,
} from './onboarding-machine.js'
export { createDbOnboardingStore } from './db-onboarding-store.js'

export type {
  OAuthPlatform,
  OAuthFailureReason,
  OAuthGuideResult,
} from './oauth-guide.js'
export {
  getOAuthUrl,
  classifyFailure,
  buildGuideResult,
  getSupportedPlatforms,
  validatePlatformSelection,
} from './oauth-guide.js'

export type {
  CheckCategory,
  HealthCheckItem,
  HealthCheckReport,
  HealthCheckDeps,
} from './health-check.js'
export {
  runHealthCheck,
  createNoopDeps,
} from './health-check.js'

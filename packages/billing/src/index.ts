export type {
  PlanName,
  PlanFeatures,
  StripeProduct,
  OverageRate,
  UsageEvent,
} from './billing.types.js'

export {
  STRIPE_PRODUCTS,
  STRIPE_BILLING_METER_ID,
  OVERAGE_RATES,
  getStripeProduct,
  getOverageRate,
} from './stripe-setup.js'

export {
  createStripeBillingClient,
  StripeBillingClientError,
} from './stripe-client.js'
export type {
  StripeBillingClient,
  StripeBillingClientDeps,
  CreateCheckoutSessionInput,
  CreatePortalSessionInput,
  StripeCheckoutSession,
  StripePortalSession,
  StripeBillingErrorCode,
} from './stripe-client.js'

export type { PlanEnforcementResult } from './plan-enforcer.js'
export {
  canUseAgent,
  canAddPlatform,
  canUseDataOS,
  getMonthlyBudget,
  getDataOSTier,
} from './plan-enforcer.js'

export { createSubscriptionService } from './subscription.service.js'
export type { SubscriptionService, SubscriptionDeps } from './subscription.service.js'

export { createUsageReporter } from './usage-reporter.js'
export type { UsageReporterService, UsageReporterDeps } from './usage-reporter.js'

export { createWebhookHandler } from './webhook-handler.js'
export type { WebhookHandlerService, WebhookHandlerDeps, WebhookEvent, WebhookResult } from './webhook-handler.js'

export { createReconciliationService } from './reconciliation.js'
export type { ReconciliationService, ReconciliationDeps, ReconciliationRecord } from './reconciliation.js'

export { calculateSlaCompensation } from './sla-compensation.js'
export type { CompensationResult, SlaIncident, SlaIncidentType } from './sla-compensation.js'

export {
  createAnnualSubscriptionService,
  calculateAnnualPrice,
  calculateEarlyTerminationFee,
  ANNUAL_DISCOUNT_RATE,
} from './annual-subscription.js'
export type { AnnualSubscriptionService, AnnualSubscriptionDeps } from './annual-subscription.js'

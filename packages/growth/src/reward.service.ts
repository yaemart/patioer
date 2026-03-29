import { TRIAL_PERIOD_DAYS, REFERRAL_TRIAL_EXTENSION_DAYS } from '@patioer/shared'

export interface StripeSubscriptionPort {
  updateTrialEnd(subscriptionId: string, trialEndDate: Date): Promise<void>
  applyCoupon(customerId: string, couponId: string): Promise<void>
}

export interface TenantLookupPort {
  getStripeIds(tenantId: string): Promise<{
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
  }>
}

export interface RewardServiceDeps {
  stripe: StripeSubscriptionPort
  tenantLookup: TenantLookupPort
}

export const REFERRAL_COUPON_ID = 'referrer_20_pct_off_1_month'

export function createRewardService(deps: RewardServiceDeps) {
  const { stripe, tenantLookup } = deps

  async function extendTrial(newTenantId: string): Promise<{ newTrialDays: number }> {
    const ids = await tenantLookup.getStripeIds(newTenantId)
    if (!ids.stripeSubscriptionId) {
      throw new Error(`Tenant ${newTenantId} has no active subscription`)
    }

    const newTrialEnd = new Date(
      Date.now() + REFERRAL_TRIAL_EXTENSION_DAYS * 24 * 60 * 60 * 1000,
    )

    await stripe.updateTrialEnd(ids.stripeSubscriptionId, newTrialEnd)

    return { newTrialDays: REFERRAL_TRIAL_EXTENSION_DAYS }
  }

  async function applyReferrerDiscount(referrerTenantId: string): Promise<{ couponApplied: boolean }> {
    const ids = await tenantLookup.getStripeIds(referrerTenantId)
    if (!ids.stripeCustomerId) {
      return { couponApplied: false }
    }

    await stripe.applyCoupon(ids.stripeCustomerId, REFERRAL_COUPON_ID)
    return { couponApplied: true }
  }

  function calculateTrialExtension(): {
    originalDays: number
    extendedDays: number
    totalDays: number
  } {
    return {
      originalDays: TRIAL_PERIOD_DAYS,
      extendedDays: REFERRAL_TRIAL_EXTENSION_DAYS - TRIAL_PERIOD_DAYS,
      totalDays: REFERRAL_TRIAL_EXTENSION_DAYS,
    }
  }

  return { extendTrial, applyReferrerDiscount, calculateTrialExtension }
}

export type RewardService = ReturnType<typeof createRewardService>

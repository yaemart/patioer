import { describe, expect, it, vi } from 'vitest'
import { createRewardService, REFERRAL_COUPON_ID } from './reward.service.js'
import type { RewardServiceDeps } from './reward.service.js'
import { TRIAL_PERIOD_DAYS, REFERRAL_TRIAL_EXTENSION_DAYS } from '@patioer/shared'

function makeDeps(overrides?: Partial<RewardServiceDeps>): RewardServiceDeps {
  return {
    stripe: {
      updateTrialEnd: vi.fn().mockResolvedValue(undefined),
      applyCoupon: vi.fn().mockResolvedValue(undefined),
    },
    tenantLookup: {
      getStripeIds: vi.fn().mockResolvedValue({
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_456',
      }),
    },
    ...overrides,
  }
}

describe('createRewardService', () => {
  describe('extendTrial', () => {
    it('extends trial to 30 days for referred tenant', async () => {
      const deps = makeDeps()
      const svc = createRewardService(deps)

      const result = await svc.extendTrial('t-new')
      expect(result.newTrialDays).toBe(REFERRAL_TRIAL_EXTENSION_DAYS)
      expect(deps.stripe.updateTrialEnd).toHaveBeenCalledWith(
        'sub_456',
        expect.any(Date),
      )
    })

    it('throws when tenant has no subscription', async () => {
      const deps = makeDeps({
        tenantLookup: {
          getStripeIds: vi.fn().mockResolvedValue({
            stripeCustomerId: 'cus_123',
            stripeSubscriptionId: null,
          }),
        },
      })
      const svc = createRewardService(deps)

      await expect(svc.extendTrial('t-new')).rejects.toThrow(
        'has no active subscription',
      )
    })
  })

  describe('applyReferrerDiscount', () => {
    it('applies 20% coupon to referrer', async () => {
      const deps = makeDeps()
      const svc = createRewardService(deps)

      const result = await svc.applyReferrerDiscount('t-referrer')
      expect(result.couponApplied).toBe(true)
      expect(deps.stripe.applyCoupon).toHaveBeenCalledWith(
        'cus_123',
        REFERRAL_COUPON_ID,
      )
    })

    it('returns false when referrer has no Stripe customer', async () => {
      const deps = makeDeps({
        tenantLookup: {
          getStripeIds: vi.fn().mockResolvedValue({
            stripeCustomerId: null,
            stripeSubscriptionId: null,
          }),
        },
      })
      const svc = createRewardService(deps)

      const result = await svc.applyReferrerDiscount('t-referrer')
      expect(result.couponApplied).toBe(false)
    })
  })

  describe('calculateTrialExtension', () => {
    it('returns correct trial extension breakdown', () => {
      const deps = makeDeps()
      const svc = createRewardService(deps)

      const ext = svc.calculateTrialExtension()
      expect(ext.originalDays).toBe(TRIAL_PERIOD_DAYS)
      expect(ext.totalDays).toBe(REFERRAL_TRIAL_EXTENSION_DAYS)
      expect(ext.extendedDays).toBe(REFERRAL_TRIAL_EXTENSION_DAYS - TRIAL_PERIOD_DAYS)
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  calculateAnnualPrice,
  calculateEarlyTerminationFee,
  createAnnualSubscriptionService,
  ANNUAL_DISCOUNT_RATE,
} from './annual-subscription.js'
import type { AnnualSubscriptionDeps } from './annual-subscription.js'

describe('calculateAnnualPrice', () => {
  it('calculates starter annual price at 80% of yearly', () => {
    const result = calculateAnnualPrice('starter')
    expect(result.monthlyPrice).toBe(299)
    expect(result.annualPrice).toBeCloseTo(299 * 12 * ANNUAL_DISCOUNT_RATE, 2)
    expect(result.discountPct).toBe(20)
    expect(result.savingsUsd).toBeGreaterThan(0)
  })

  it('calculates growth annual price', () => {
    const result = calculateAnnualPrice('growth')
    expect(result.monthlyPrice).toBe(799)
    expect(result.annualPrice).toBeCloseTo(799 * 12 * ANNUAL_DISCOUNT_RATE, 2)
  })

  it('calculates scale annual price', () => {
    const result = calculateAnnualPrice('scale')
    expect(result.monthlyPrice).toBe(1999)
    expect(result.annualPrice).toBeCloseTo(1999 * 12 * ANNUAL_DISCOUNT_RATE, 2)
  })
})

describe('calculateEarlyTerminationFee', () => {
  it('calculates 50% of remaining months', () => {
    const result = calculateEarlyTerminationFee('starter', 6)
    expect(result.feeUsd).toBe(299 * 6 * 0.5)
    expect(result.remainingMonths).toBe(6)
  })

  it('returns 0 fee for 0 remaining months', () => {
    const result = calculateEarlyTerminationFee('growth', 0)
    expect(result.feeUsd).toBe(0)
  })
})

function makeDeps(overrides?: Partial<AnnualSubscriptionDeps>): AnnualSubscriptionDeps {
  return {
    stripe: {
      subscriptions: {
        update: vi.fn().mockResolvedValue({ id: 'sub_updated' }),
      },
      invoices: {
        create: vi.fn().mockResolvedValue({ id: 'inv_123' }),
        addInvoiceItem: vi.fn().mockResolvedValue(undefined),
        finalizeInvoice: vi.fn().mockResolvedValue(undefined),
      },
    },
    tenantStore: {
      getTenant: vi.fn().mockResolvedValue({
        id: 't-1',
        plan: 'growth',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_456',
        billingCycle: 'monthly',
      }),
      updateTenant: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  }
}

describe('createAnnualSubscriptionService', () => {
  describe('switchToAnnual', () => {
    it('updates subscription to yearly price', async () => {
      const deps = makeDeps()
      const svc = createAnnualSubscriptionService(deps)

      const result = await svc.switchToAnnual('t-1')
      expect(result.subscriptionId).toBe('sub_updated')
      expect(deps.stripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_456',
        expect.objectContaining({
          metadata: { billingCycle: 'annual' },
        }),
      )
      expect(deps.tenantStore.updateTenant).toHaveBeenCalledWith(
        't-1',
        expect.objectContaining({ billingCycle: 'annual' }),
      )
    })

    it('throws when tenant has no subscription', async () => {
      const deps = makeDeps({
        tenantStore: {
          getTenant: vi.fn().mockResolvedValue(null),
          updateTenant: vi.fn(),
        },
      })
      const svc = createAnnualSubscriptionService(deps)

      await expect(svc.switchToAnnual('t-1')).rejects.toThrow('no active subscription')
    })
  })

  describe('cancelAnnualEarly', () => {
    it('creates early termination invoice', async () => {
      const sixMonthsAgo = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000)
      const deps = makeDeps({
        tenantStore: {
          getTenant: vi.fn().mockResolvedValue({
            id: 't-1',
            plan: 'growth',
            stripeCustomerId: 'cus_123',
            stripeSubscriptionId: 'sub_456',
            billingCycle: 'annual',
            annualStartDate: sixMonthsAgo.toISOString(),
          }),
          updateTenant: vi.fn(),
        },
      })
      const svc = createAnnualSubscriptionService(deps)

      const result = await svc.cancelAnnualEarly('t-1')
      expect(result.invoiceId).toBe('inv_123')
      expect(result.feeUsd).toBeGreaterThan(0)
      expect(deps.stripe.invoices.create).toHaveBeenCalled()
      expect(deps.stripe.invoices.finalizeInvoice).toHaveBeenCalledWith('inv_123')
    })

    it('throws when tenant is not on annual plan', async () => {
      const deps = makeDeps()
      const svc = createAnnualSubscriptionService(deps)

      await expect(svc.cancelAnnualEarly('t-1')).rejects.toThrow('not on an annual plan')
    })
  })
})

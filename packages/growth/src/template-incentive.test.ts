import { describe, expect, it, vi } from 'vitest'
import {
  createTemplateIncentiveService,
  TEMPLATE_CONTRIBUTOR_COUPON_ID,
} from './template-incentive.js'
import type { TemplateIncentiveDeps } from './template-incentive.js'

function makeDeps(overrides?: Partial<TemplateIncentiveDeps>): TemplateIncentiveDeps {
  return {
    store: {
      hasReceivedIncentive: vi.fn().mockResolvedValue(false),
      recordIncentive: vi.fn().mockResolvedValue(undefined),
    },
    stripe: {
      applyCoupon: vi.fn().mockResolvedValue(undefined),
    },
    tenantLookup: {
      getStripeCustomerId: vi.fn().mockResolvedValue('cus_author'),
    },
    ...overrides,
  }
}

describe('template-incentive', () => {
  it('rewards when downloads >= 5', async () => {
    const deps = makeDeps()
    const svc = createTemplateIncentiveService(deps)

    const result = await svc.checkAndReward({
      templateId: 'tpl-1',
      authorTenantId: 't-author',
      downloads: 5,
    })

    expect(result.eligible).toBe(true)
    expect(result.rewarded).toBe(true)
    expect(deps.stripe.applyCoupon).toHaveBeenCalledWith(
      'cus_author',
      TEMPLATE_CONTRIBUTOR_COUPON_ID,
    )
    expect(deps.store.recordIncentive).toHaveBeenCalledWith('t-author', 'tpl-1')
  })

  it('does not reward when downloads < 5', async () => {
    const deps = makeDeps()
    const svc = createTemplateIncentiveService(deps)

    const result = await svc.checkAndReward({
      templateId: 'tpl-1',
      authorTenantId: 't-author',
      downloads: 3,
    })

    expect(result.eligible).toBe(false)
    expect(result.rewarded).toBe(false)
    expect(deps.stripe.applyCoupon).not.toHaveBeenCalled()
  })

  it('does not reward twice', async () => {
    const deps = makeDeps({
      store: {
        hasReceivedIncentive: vi.fn().mockResolvedValue(true),
        recordIncentive: vi.fn(),
      },
    })
    const svc = createTemplateIncentiveService(deps)

    const result = await svc.checkAndReward({
      templateId: 'tpl-1',
      authorTenantId: 't-author',
      downloads: 10,
    })

    expect(result.eligible).toBe(true)
    expect(result.rewarded).toBe(false)
    expect(deps.stripe.applyCoupon).not.toHaveBeenCalled()
  })

  it('does not reward when author has no Stripe customer', async () => {
    const deps = makeDeps({
      tenantLookup: {
        getStripeCustomerId: vi.fn().mockResolvedValue(null),
      },
    })
    const svc = createTemplateIncentiveService(deps)

    const result = await svc.checkAndReward({
      templateId: 'tpl-1',
      authorTenantId: 't-author',
      downloads: 6,
    })

    expect(result.eligible).toBe(true)
    expect(result.rewarded).toBe(false)
  })
})

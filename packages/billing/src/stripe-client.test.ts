import { describe, expect, it, vi } from 'vitest'
import {
  createStripeBillingClient,
  StripeBillingClientError,
} from './stripe-client.js'

describe('createStripeBillingClient', () => {
  it('creates checkout sessions through Stripe form API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.test/session',
      }),
    } as Response)

    const client = createStripeBillingClient({
      secretKey: 'sk_test_123',
      fetchImpl,
    })

    const session = await client.createCheckoutSession({
      priceId: 'price_growth',
      successUrl: 'https://app.example.com/success',
      cancelUrl: 'https://app.example.com/cancel',
      trialPeriodDays: 14,
      metadata: {
        tenantId: 'tenant-1',
        plan: 'growth',
      },
    })

    expect(session).toEqual({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.test/session',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/checkout/sessions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk_test_123',
        }),
        body: expect.stringContaining('line_items%5B0%5D%5Bprice%5D=price_growth'),
      }),
    )
  })

  it('creates portal sessions through Stripe form API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        url: 'https://billing.stripe.test/portal',
      }),
    } as Response)

    const client = createStripeBillingClient({
      secretKey: 'sk_test_123',
      fetchImpl,
    })

    const session = await client.createPortalSession({
      customerId: 'cus_123',
      returnUrl: 'https://app.example.com/dashboard',
    })

    expect(session).toEqual({
      url: 'https://billing.stripe.test/portal',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/billing_portal/sessions',
      expect.objectContaining({
        method: 'POST',
      }),
    )
  })

  it('throws typed not_configured error when secret key is missing', async () => {
    const client = createStripeBillingClient({
      secretKey: '',
      fetchImpl: vi.fn(),
    })

    await expect(
      client.createCheckoutSession({
        priceId: 'price_starter',
        successUrl: 'https://app.example.com/success',
        cancelUrl: 'https://app.example.com/cancel',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<StripeBillingClientError>>({
        code: 'not_configured',
        message: 'Stripe not configured',
      }),
    )
  })

  it('throws typed request_failed error when Stripe rejects request', async () => {
    const client = createStripeBillingClient({
      secretKey: 'sk_test_123',
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: { message: 'bad request' } }),
      } as Response),
    })

    await expect(
      client.createPortalSession({
        customerId: 'cus_123',
        returnUrl: 'https://app.example.com/dashboard',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<StripeBillingClientError>>({
        code: 'request_failed',
      }),
    )
  })
})

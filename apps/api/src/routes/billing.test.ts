import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import billingRoute from './billing.js'

const TEST_TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'

const {
  mockCreateCheckoutSession,
  mockCreatePortalSession,
  mockDbSelect,
} = vi.hoisted(() => ({
  mockCreateCheckoutSession: vi.fn(),
  mockCreatePortalSession: vi.fn(),
  mockDbSelect: vi.fn(),
}))

vi.mock('@patioer/billing', async () => {
  const actual = await vi.importActual<typeof import('@patioer/billing')>('@patioer/billing')
  return {
    ...actual,
    createStripeBillingClient: vi.fn(() => ({
      createCheckoutSession: mockCreateCheckoutSession,
      createPortalSession: mockCreatePortalSession,
    })),
  }
})

vi.mock('@patioer/db', async () => {
  const actual = await vi.importActual<typeof import('@patioer/db')>('@patioer/db')
  const fromFn = vi.fn(() => ({ where: vi.fn(() => mockDbSelect()) }))
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({ from: fromFn })),
    },
  }
})

const { StripeBillingClientError, createStripeBillingClient } = await import('@patioer/billing')

function createApp(options?: { withTenant?: boolean; plan?: string }) {
  const app = Fastify()
  app.decorateRequest('withDb', null)
  app.decorateRequest('auth', null)
  app.addHook('onRequest', async (request) => {
    if (options?.withTenant === false) {
      request.tenantId = undefined
      return
    }
    request.tenantId = TEST_TENANT_ID
    request.auth = {
      tenantId: TEST_TENANT_ID,
      userId: 'u1',
      email: 'test@test.com',
      role: 'owner',
      plan: options?.plan ?? 'starter',
      subjectType: 'user' as const,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
    }
    request.withDb = async (cb) => {
      const query = {
        then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
          mockDbSelect().then(onFulfilled, onRejected),
        catch: (onRejected: (reason: unknown) => unknown) => mockDbSelect().catch(onRejected),
        finally: (onFinally?: (() => void) | undefined) => mockDbSelect().finally(onFinally),
        limit: vi.fn(() => mockDbSelect()),
      }
      return cb({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => query),
          })),
        })),
      } as never)
    }
  })
  app.register(billingRoute)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.WEB_URL = 'https://app.example.com'
  process.env.STRIPE_SECRET_KEY = 'sk_test_123'
  process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter'
  process.env.STRIPE_PRICE_GROWTH_MONTHLY = 'price_growth'
  process.env.STRIPE_PRICE_SCALE_MONTHLY = 'price_scale'
  mockCreateCheckoutSession.mockResolvedValue({
    id: 'cs_test_123',
    url: 'https://checkout.stripe.test/session',
  })
  mockCreatePortalSession.mockResolvedValue({
    url: 'https://billing.stripe.test/portal',
  })
  mockDbSelect.mockResolvedValue([{ stripeCustomerId: null }])
})

describe('billing routes', () => {
  describe('POST /api/v1/billing/checkout-session', () => {
    it('returns 400 without tenant context', async () => {
      const app = createApp({ withTenant: false })
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/checkout-session',
        payload: { plan: 'starter' },
      })
      expect(res.statusCode).toBe(400)
      await app.close()
    })

    it('returns 503 when Stripe is not configured', async () => {
      mockCreateCheckoutSession.mockRejectedValueOnce(
        new StripeBillingClientError('not_configured', 'Stripe not configured'),
      )
      const app = createApp()
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/checkout-session',
        payload: { plan: 'starter' },
      })
      expect(res.statusCode).toBe(503)
      await app.close()
    })

    it('creates checkout session through billing domain client', async () => {
      const app = createApp()
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/checkout-session',
        payload: { plan: 'growth' },
      })

      expect(res.statusCode).toBe(200)
      expect(createStripeBillingClient).toHaveBeenCalledWith({
        secretKey: 'sk_test_123',
      })
      expect(mockCreateCheckoutSession).toHaveBeenCalledWith({
        priceId: 'price_growth',
        successUrl: 'https://app.example.com/dashboard?session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: 'https://app.example.com/pricing',
        trialPeriodDays: 14,
        metadata: {
          tenantId: '123e4567-e89b-12d3-a456-426614174000',
          plan: 'growth',
        },
      })
      expect(res.json()).toEqual({
        url: 'https://checkout.stripe.test/session',
        sessionId: 'cs_test_123',
      })
      await app.close()
    })

    it('rejects invalid plan names', async () => {
      const app = createApp()
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/billing/checkout-session',
        payload: { plan: 'enterprise' },
      })
      expect(res.statusCode).toBe(400)
      await app.close()
    })
  })

  describe('GET /api/v1/billing/portal-session', () => {
    it('returns 400 without tenant context', async () => {
      const app = createApp({ withTenant: false })
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/portal-session',
      })
      expect(res.statusCode).toBe(400)
      await app.close()
    })

    it('returns 400 when tenant has no stripe customer id', async () => {
      mockDbSelect.mockResolvedValueOnce([{ stripeCustomerId: null }])
      const app = createApp()
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/portal-session',
      })

      expect(res.statusCode).toBe(400)
      expect(mockCreatePortalSession).not.toHaveBeenCalled()
      await app.close()
    })

    it('creates portal session using stripe customer id from DB', async () => {
      mockDbSelect.mockResolvedValueOnce([{ stripeCustomerId: 'cus_123' }])
      const app = createApp()
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/portal-session',
      })

      expect(res.statusCode).toBe(200)
      expect(mockCreatePortalSession).toHaveBeenCalledWith({
        customerId: 'cus_123',
        returnUrl: 'https://app.example.com/dashboard',
      })
      expect(res.json()).toEqual({ url: 'https://billing.stripe.test/portal' })
      await app.close()
    })
  })

  describe('GET /api/v1/billing/usage', () => {
    it('returns usage summary with plan from JWT auth', async () => {
      const app = createApp({ plan: 'growth' })
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/usage',
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.plan).toBe('growth')
      expect(body.budgetUsd).toBe(500)
      expect(body.usedUsd).toBe(0)
      expect(body.isOverBudget).toBe(false)
      await app.close()
    })

    it('returns 400 without tenant context', async () => {
      const app = createApp({ withTenant: false })
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/usage',
      })
      expect(res.statusCode).toBe(400)
      await app.close()
    })

    it('defaults to starter plan when auth has no recognized plan', async () => {
      const app = createApp()
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/billing/usage',
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().budgetUsd).toBe(160)
      await app.close()
    })
  })
})

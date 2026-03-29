export type StripeBillingErrorCode =
  | 'not_configured'
  | 'request_failed'

export class StripeBillingClientError extends Error {
  constructor(
    public readonly code: StripeBillingErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'StripeBillingClientError'
  }
}

export interface CreateCheckoutSessionInput {
  priceId: string
  quantity?: number
  successUrl: string
  cancelUrl: string
  trialPeriodDays?: number
  metadata?: Record<string, string>
}

export interface CreatePortalSessionInput {
  customerId: string
  returnUrl: string
}

export interface StripeCheckoutSession {
  id: string
  url: string
}

export interface StripePortalSession {
  url: string
}

export interface StripeBillingClient {
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<StripeCheckoutSession>
  createPortalSession(input: CreatePortalSessionInput): Promise<StripePortalSession>
}

export interface StripeBillingClientDeps {
  secretKey: string
  fetchImpl?: typeof fetch
}

async function stripePost<T>(
  secretKey: string,
  path: string,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<T> {
  if (!secretKey) {
    throw new StripeBillingClientError('not_configured', 'Stripe not configured')
  }

  const res = await fetchImpl(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new StripeBillingClientError(
      'request_failed',
      `Stripe error: ${JSON.stringify(err)}`,
    )
  }

  return res.json() as Promise<T>
}

export function createStripeBillingClient(
  deps: StripeBillingClientDeps,
): StripeBillingClient {
  const fetchImpl = deps.fetchImpl ?? fetch

  return {
    async createCheckoutSession(input) {
      return stripePost<StripeCheckoutSession>(
        deps.secretKey,
        '/checkout/sessions',
        {
          mode: 'subscription',
          'line_items[0][price]': input.priceId,
          'line_items[0][quantity]': String(input.quantity ?? 1),
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          ...(input.trialPeriodDays != null
            ? { 'subscription_data[trial_period_days]': String(input.trialPeriodDays) }
            : {}),
          ...Object.fromEntries(
            Object.entries(input.metadata ?? {}).map(([key, value]) => [
              `subscription_data[metadata][${key}]`,
              value,
            ]),
          ),
        },
        fetchImpl,
      )
    },

    async createPortalSession(input) {
      return stripePost<StripePortalSession>(
        deps.secretKey,
        '/billing_portal/sessions',
        {
          customer: input.customerId,
          return_url: input.returnUrl,
        },
        fetchImpl,
      )
    },
  }
}

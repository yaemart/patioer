/**
 * Stripe Test Mode Setup Script
 *
 * Creates the 3 Products + 3 Prices + 1 Billing Meter in Stripe Test Mode.
 * Run: pnpm exec tsx scripts/stripe-setup.ts
 *
 * Requires STRIPE_SECRET_KEY to be set (test mode key: sk_test_...).
 * Outputs the created IDs for .env configuration.
 */

import { PLAN_MONTHLY_PRICE_USD, PLAN_NAMES, type PlanName } from '@patioer/shared'

const STRIPE_API = 'https://api.stripe.com/v1'

async function stripeRequest<T>(path: string, body?: Record<string, string>): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY env var is required')

  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(`Stripe API error: ${JSON.stringify(err)}`)
  }

  return res.json() as Promise<T>
}

interface StripeProduct { id: string }
interface StripePrice { id: string }
interface StripeMeter { id: string }

const PLAN_DESCRIPTIONS: Record<PlanName, string> = {
  starter: 'ElectroOS Starter — 1 platform, 3 agents, email support',
  growth: 'ElectroOS Growth — 3 platforms, 7 agents, chat support, partial DataOS',
  scale: 'ElectroOS Scale — 5 platforms, 9 agents, dedicated support, full DataOS',
}

async function createProduct(plan: PlanName): Promise<{ productId: string; priceId: string }> {
  const product = await stripeRequest<StripeProduct>('/products', {
    name: `ElectroOS ${plan.charAt(0).toUpperCase() + plan.slice(1)}`,
    description: PLAN_DESCRIPTIONS[plan],
  })

  const price = await stripeRequest<StripePrice>('/prices', {
    product: product.id,
    currency: 'usd',
    unit_amount: String(PLAN_MONTHLY_PRICE_USD[plan] * 100),
    'recurring[interval]': 'month',
  })

  return { productId: product.id, priceId: price.id }
}

async function createBillingMeter(): Promise<string> {
  const meter = await stripeRequest<StripeMeter>('/billing/meters', {
    display_name: 'Agent Token Usage',
    event_name: 'agent_token_usage',
    'default_aggregation[formula]': 'sum',
  })
  return meter.id
}

async function main() {
  console.log('=== ElectroOS Stripe Setup (Test Mode) ===\n')

  const results: Record<string, string> = {}

  for (const plan of PLAN_NAMES) {
    console.log(`Creating ${plan} product + price...`)
    const { productId, priceId } = await createProduct(plan)
    const envKey = plan.toUpperCase()
    results[`STRIPE_PRODUCT_${envKey}`] = productId
    results[`STRIPE_PRICE_${envKey}_MONTHLY`] = priceId
    console.log(`  Product: ${productId}`)
    console.log(`  Price:   ${priceId}\n`)
  }

  console.log('Creating billing meter...')
  const meterId = await createBillingMeter()
  results['STRIPE_BILLING_METER_ID'] = meterId
  console.log(`  Meter: ${meterId}\n`)

  console.log('=== Add these to your .env ===\n')
  for (const [key, value] of Object.entries(results)) {
    console.log(`${key}=${value}`)
  }
}

main().catch((err) => {
  console.error('Setup failed:', err)
  process.exit(1)
})

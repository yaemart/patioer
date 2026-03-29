import type { PlanName } from './billing.types.js'
import { STRIPE_PRODUCTS } from './stripe-setup.js'
import { PLAN_MONTHLY_PRICE_USD } from '@patioer/shared'

export const ANNUAL_DISCOUNT_RATE = 0.8

export function calculateAnnualPrice(plan: PlanName): {
  monthlyPrice: number
  annualPrice: number
  savingsUsd: number
  discountPct: number
} {
  const monthly = PLAN_MONTHLY_PRICE_USD[plan]
  const fullYear = monthly * 12
  const annualPrice = Math.round(fullYear * ANNUAL_DISCOUNT_RATE * 100) / 100
  const savingsUsd = Math.round((fullYear - annualPrice) * 100) / 100

  return {
    monthlyPrice: monthly,
    annualPrice,
    savingsUsd,
    discountPct: Math.round((1 - ANNUAL_DISCOUNT_RATE) * 100),
  }
}

export const EARLY_TERMINATION_RATE = 0.5

export function calculateEarlyTerminationFee(
  plan: PlanName,
  remainingMonths: number,
): {
  monthlyPrice: number
  remainingMonths: number
  feeUsd: number
} {
  const monthly = PLAN_MONTHLY_PRICE_USD[plan]
  const feeUsd = Math.round(monthly * remainingMonths * EARLY_TERMINATION_RATE * 100) / 100

  return { monthlyPrice: monthly, remainingMonths, feeUsd }
}

export interface AnnualStripeClient {
  subscriptions: {
    update(id: string, params: {
      items?: Array<{ price: string }>
      metadata?: Record<string, string>
    }): Promise<{ id: string }>
  }
  invoices: {
    create(params: {
      customer: string
      description: string
      auto_advance: boolean
    }): Promise<{ id: string }>
    addInvoiceItem(params: {
      customer: string
      amount: number
      currency: string
      description: string
      invoice: string
    }): Promise<void>
    finalizeInvoice(invoiceId: string): Promise<void>
  }
}

export interface AnnualTenantStore {
  getTenant(tenantId: string): Promise<{
    id: string
    plan: string
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
    billingCycle?: 'monthly' | 'annual'
    annualStartDate?: string
  } | null>
  updateTenant(tenantId: string, data: Record<string, unknown>): Promise<void>
}

export interface AnnualSubscriptionDeps {
  stripe: AnnualStripeClient
  tenantStore: AnnualTenantStore
}

export function createAnnualSubscriptionService(deps: AnnualSubscriptionDeps) {
  const { stripe, tenantStore } = deps

  async function switchToAnnual(tenantId: string): Promise<{ subscriptionId: string }> {
    const tenant = await tenantStore.getTenant(tenantId)
    if (!tenant?.stripeSubscriptionId) {
      throw new Error(`Tenant ${tenantId} has no active subscription`)
    }

    const plan = tenant.plan as PlanName
    const product = STRIPE_PRODUCTS[plan]
    if (!product.yearlyPriceId) {
      throw new Error(`No yearly price configured for plan: ${plan}`)
    }

    const updated = await stripe.subscriptions.update(tenant.stripeSubscriptionId, {
      items: [{ price: product.yearlyPriceId }],
      metadata: { billingCycle: 'annual' },
    })

    await tenantStore.updateTenant(tenantId, {
      billingCycle: 'annual',
      annualStartDate: new Date().toISOString(),
    })

    return { subscriptionId: updated.id }
  }

  async function cancelAnnualEarly(tenantId: string): Promise<{
    feeUsd: number
    invoiceId: string
  }> {
    const tenant = await tenantStore.getTenant(tenantId)
    if (!tenant?.stripeSubscriptionId || !tenant.stripeCustomerId) {
      throw new Error(`Tenant ${tenantId} has no active subscription`)
    }
    if (tenant.billingCycle !== 'annual' || !tenant.annualStartDate) {
      throw new Error(`Tenant ${tenantId} is not on an annual plan`)
    }

    const startDate = new Date(tenant.annualStartDate)
    const monthsUsed = Math.ceil(
      (Date.now() - startDate.getTime()) / (30 * 24 * 60 * 60 * 1000),
    )
    const remainingMonths = Math.max(0, 12 - monthsUsed)
    const plan = tenant.plan as PlanName
    const { feeUsd } = calculateEarlyTerminationFee(plan, remainingMonths)

    const invoice = await stripe.invoices.create({
      customer: tenant.stripeCustomerId,
      description: `Early termination fee — ${remainingMonths} months remaining on annual ${plan} plan`,
      auto_advance: true,
    })

    await stripe.invoices.addInvoiceItem({
      customer: tenant.stripeCustomerId,
      amount: Math.round(feeUsd * 100),
      currency: 'usd',
      description: `Early termination: ${remainingMonths} × $${PLAN_MONTHLY_PRICE_USD[plan]} × 50%`,
      invoice: invoice.id,
    })

    await stripe.invoices.finalizeInvoice(invoice.id)

    return { feeUsd, invoiceId: invoice.id }
  }

  return { switchToAnnual, cancelAnnualEarly, calculateAnnualPrice, calculateEarlyTerminationFee }
}

export type AnnualSubscriptionService = ReturnType<typeof createAnnualSubscriptionService>

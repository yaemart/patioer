import type { PlanName } from './billing.types.js'
import { STRIPE_PRODUCTS } from './stripe-setup.js'
import { TRIAL_PERIOD_DAYS, PLAN_AGENT_LIMITS } from '@patioer/shared'

export interface StripeClient {
  customers: {
    create(params: { email?: string; metadata: Record<string, string> }): Promise<{ id: string }>
  }
  subscriptions: {
    create(params: {
      customer: string
      items: Array<{ price: string }>
      trial_period_days?: number
      metadata?: Record<string, string>
    }): Promise<{ id: string; status: string }>
    update(id: string, params: {
      items?: Array<{ price: string }>
      proration_behavior?: string
      metadata?: Record<string, string>
    }): Promise<{ id: string; status: string }>
    cancel(id: string): Promise<{ id: string; status: string }>
  }
}

export interface TenantStore {
  getTenant(tenantId: string): Promise<{
    id: string
    plan: string
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
  } | null>
  updateTenant(tenantId: string, data: Record<string, unknown>): Promise<void>
}

export interface AgentManager {
  suspendAllAgents(tenantId: string): Promise<number>
  suspendAgents(tenantId: string, agentIds: string[]): Promise<number>
  getActiveAgentIds(tenantId: string): Promise<string[]>
}

export interface DataRetentionScheduler {
  scheduleDataDeletion(tenantId: string, options: { days: number }): Promise<void>
}

export interface SubscriptionDeps {
  stripe: StripeClient
  tenantStore: TenantStore
  agentManager: AgentManager
  retentionScheduler: DataRetentionScheduler
}

export function createSubscriptionService(deps: SubscriptionDeps) {
  const { stripe, tenantStore, agentManager, retentionScheduler } = deps

  async function createSubscription(
    tenantId: string,
    plan: PlanName,
    email?: string,
  ): Promise<{ customerId: string; subscriptionId: string }> {
    const product = STRIPE_PRODUCTS[plan]

    const customer = await stripe.customers.create({
      email,
      metadata: { tenantId },
    })

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: product.priceId }],
      trial_period_days: TRIAL_PERIOD_DAYS,
      metadata: { tenantId, plan },
    })

    const trialEndsAt = new Date(Date.now() + TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000)

    await tenantStore.updateTenant(tenantId, {
      stripeCustomerId: customer.id,
      stripeSubscriptionId: subscription.id,
      plan,
      trialEndsAt: trialEndsAt.toISOString(),
    })

    return { customerId: customer.id, subscriptionId: subscription.id }
  }

  async function upgradePlan(
    tenantId: string,
    newPlan: PlanName,
  ): Promise<void> {
    const tenant = await tenantStore.getTenant(tenantId)
    if (!tenant?.stripeSubscriptionId) {
      throw new Error(`Tenant ${tenantId} has no active subscription`)
    }

    const product = STRIPE_PRODUCTS[newPlan]

    await stripe.subscriptions.update(tenant.stripeSubscriptionId, {
      items: [{ price: product.priceId }],
      proration_behavior: 'create_prorations',
      metadata: { plan: newPlan },
    })

    await tenantStore.updateTenant(tenantId, { plan: newPlan })
  }

  async function downgradePlan(
    tenantId: string,
    newPlan: PlanName,
  ): Promise<{ suspendedAgents: string[] }> {
    const tenant = await tenantStore.getTenant(tenantId)
    if (!tenant?.stripeSubscriptionId) {
      throw new Error(`Tenant ${tenantId} has no active subscription`)
    }

    const activeAgents = await agentManager.getActiveAgentIds(tenantId)
    const allowedAgents = PLAN_AGENT_LIMITS[newPlan]
    const agentsToSuspend = activeAgents.filter((id) => !allowedAgents.includes(id))

    if (agentsToSuspend.length > 0) {
      await agentManager.suspendAgents(tenantId, agentsToSuspend)
    }

    const product = STRIPE_PRODUCTS[newPlan]

    await stripe.subscriptions.update(tenant.stripeSubscriptionId, {
      items: [{ price: product.priceId }],
      proration_behavior: 'create_prorations',
      metadata: { plan: newPlan },
    })

    await tenantStore.updateTenant(tenantId, { plan: newPlan })

    return { suspendedAgents: agentsToSuspend }
  }

  async function cancelSubscription(tenantId: string): Promise<void> {
    const tenant = await tenantStore.getTenant(tenantId)
    if (!tenant?.stripeSubscriptionId) {
      throw new Error(`Tenant ${tenantId} has no active subscription`)
    }

    await stripe.subscriptions.cancel(tenant.stripeSubscriptionId)
    await agentManager.suspendAllAgents(tenantId)
    await retentionScheduler.scheduleDataDeletion(tenantId, { days: 30 })

    await tenantStore.updateTenant(tenantId, {
      stripeSubscriptionId: null,
      plan: 'starter',
    })
  }

  return { createSubscription, upgradePlan, downgradePlan, cancelSubscription }
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>

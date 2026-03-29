import type { PlanName } from './billing.types.js'
import { PLAN_AGENT_LIMITS } from '@patioer/shared'

export type WebhookEventType =
  | 'invoice.payment_succeeded'
  | 'invoice.payment_failed'
  | 'customer.subscription.deleted'
  | 'customer.subscription.updated'

export interface WebhookEvent {
  type: WebhookEventType
  data: {
    object: {
      customer?: string
      subscription?: string
      metadata?: Record<string, string>
      items?: { data: Array<{ price: { id: string } }> }
    }
  }
}

export interface WebhookTenantStore {
  findTenantByStripeCustomerId(customerId: string): Promise<{
    id: string
    plan: string
    stripeSubscriptionId: string | null
  } | null>
  updateTenant(tenantId: string, data: Record<string, unknown>): Promise<void>
}

export interface WebhookAgentManager {
  suspendAllAgents(tenantId: string): Promise<number>
  suspendAgents(tenantId: string, agentIds: string[]): Promise<number>
  getActiveAgentIds(tenantId: string): Promise<string[]>
}

export interface WebhookUsageStore {
  resetMonthlyUsage(tenantId: string): Promise<void>
}

export interface GracePeriodScheduler {
  scheduleAgentSuspension(tenantId: string, options: { delayDays: number }): Promise<string>
  cancelScheduled(jobId: string): Promise<void>
}

export interface WebhookDataRetention {
  scheduleDataDeletion(tenantId: string, options: { days: number }): Promise<void>
}

export interface WebhookHandlerDeps {
  tenantStore: WebhookTenantStore
  agentManager: WebhookAgentManager
  usageStore: WebhookUsageStore
  gracePeriod: GracePeriodScheduler
  dataRetention: WebhookDataRetention
}

export interface WebhookResult {
  handled: boolean
  action: string
  tenantId?: string
}

const GRACE_PERIOD_DAYS = 3
const DATA_RETENTION_DAYS = 30

export function createWebhookHandler(deps: WebhookHandlerDeps) {
  const { tenantStore, agentManager, usageStore, gracePeriod, dataRetention } = deps

  async function handlePaymentSucceeded(event: WebhookEvent): Promise<WebhookResult> {
    const customerId = event.data.object.customer
    if (!customerId) return { handled: false, action: 'no_customer_id' }

    const tenant = await tenantStore.findTenantByStripeCustomerId(customerId)
    if (!tenant) return { handled: false, action: 'tenant_not_found' }

    await usageStore.resetMonthlyUsage(tenant.id)

    return { handled: true, action: 'usage_reset', tenantId: tenant.id }
  }

  async function handlePaymentFailed(event: WebhookEvent): Promise<WebhookResult> {
    const customerId = event.data.object.customer
    if (!customerId) return { handled: false, action: 'no_customer_id' }

    const tenant = await tenantStore.findTenantByStripeCustomerId(customerId)
    if (!tenant) return { handled: false, action: 'tenant_not_found' }

    const jobId = await gracePeriod.scheduleAgentSuspension(tenant.id, { delayDays: GRACE_PERIOD_DAYS })

    return { handled: true, action: `grace_period_scheduled:${jobId}`, tenantId: tenant.id }
  }

  async function handleSubscriptionDeleted(event: WebhookEvent): Promise<WebhookResult> {
    const customerId = event.data.object.customer
    if (!customerId) return { handled: false, action: 'no_customer_id' }

    const tenant = await tenantStore.findTenantByStripeCustomerId(customerId)
    if (!tenant) return { handled: false, action: 'tenant_not_found' }

    const suspended = await agentManager.suspendAllAgents(tenant.id)
    await dataRetention.scheduleDataDeletion(tenant.id, { days: DATA_RETENTION_DAYS })

    await tenantStore.updateTenant(tenant.id, {
      stripeSubscriptionId: null,
      plan: 'starter',
    })

    return { handled: true, action: `agents_suspended:${suspended}`, tenantId: tenant.id }
  }

  async function handleSubscriptionUpdated(event: WebhookEvent): Promise<WebhookResult> {
    const customerId = event.data.object.customer
    if (!customerId) return { handled: false, action: 'no_customer_id' }

    const tenant = await tenantStore.findTenantByStripeCustomerId(customerId)
    if (!tenant) return { handled: false, action: 'tenant_not_found' }

    const newPlan = event.data.object.metadata?.plan as PlanName | undefined
    if (!newPlan) return { handled: false, action: 'no_plan_in_metadata' }

    const currentPlan = tenant.plan as PlanName
    if (newPlan === currentPlan) return { handled: true, action: 'no_change', tenantId: tenant.id }

    await tenantStore.updateTenant(tenant.id, { plan: newPlan })

    const currentAllowed = PLAN_AGENT_LIMITS[currentPlan]
    const newAllowed = PLAN_AGENT_LIMITS[newPlan]

    if (newAllowed.length < currentAllowed.length) {
      const activeAgents = await agentManager.getActiveAgentIds(tenant.id)
      const agentsToSuspend = activeAgents.filter((id) => !newAllowed.includes(id))
      if (agentsToSuspend.length > 0) {
        await agentManager.suspendAgents(tenant.id, agentsToSuspend)
      }
    }

    return { handled: true, action: `plan_synced:${currentPlan}->${newPlan}`, tenantId: tenant.id }
  }

  async function handleEvent(event: WebhookEvent): Promise<WebhookResult> {
    switch (event.type) {
      case 'invoice.payment_succeeded':
        return handlePaymentSucceeded(event)
      case 'invoice.payment_failed':
        return handlePaymentFailed(event)
      case 'customer.subscription.deleted':
        return handleSubscriptionDeleted(event)
      case 'customer.subscription.updated':
        return handleSubscriptionUpdated(event)
      default: {
        const _exhaustive: never = event.type
        return { handled: false, action: `unhandled:${_exhaustive}` }
      }
    }
  }

  return { handleEvent }
}

export type WebhookHandlerService = ReturnType<typeof createWebhookHandler>

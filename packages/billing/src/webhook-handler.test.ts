import { describe, expect, it, vi } from 'vitest'
import { createWebhookHandler } from './webhook-handler.js'
import type { WebhookHandlerDeps, WebhookEvent } from './webhook-handler.js'

function createMockDeps(): WebhookHandlerDeps {
  return {
    tenantStore: {
      findTenantByStripeCustomerId: vi.fn().mockResolvedValue({
        id: 'tenant-1',
        plan: 'growth',
        stripeSubscriptionId: 'sub_test456',
      }),
      updateTenant: vi.fn().mockResolvedValue(undefined),
    },
    agentManager: {
      suspendAllAgents: vi.fn().mockResolvedValue(7),
      suspendAgents: vi.fn().mockResolvedValue(2),
      getActiveAgentIds: vi.fn().mockResolvedValue([
        'product-scout', 'price-sentinel', 'support-relay',
        'ads-optimizer', 'inventory-guard', 'content-writer', 'market-intel',
      ]),
    },
    usageStore: {
      resetMonthlyUsage: vi.fn().mockResolvedValue(undefined),
    },
    gracePeriod: {
      scheduleAgentSuspension: vi.fn().mockResolvedValue('job-123'),
      cancelScheduled: vi.fn().mockResolvedValue(undefined),
    },
    dataRetention: {
      scheduleDataDeletion: vi.fn().mockResolvedValue(undefined),
    },
  }
}

function makeEvent(type: string, customer: string, metadata?: Record<string, string>): WebhookEvent {
  return {
    type: type as WebhookEvent['type'],
    data: {
      object: {
        customer,
        metadata,
      },
    },
  }
}

describe('webhook-handler', () => {
  describe('invoice.payment_succeeded', () => {
    it('resets monthly usage for the tenant', async () => {
      const deps = createMockDeps()
      const handler = createWebhookHandler(deps)

      const result = await handler.handleEvent(makeEvent('invoice.payment_succeeded', 'cus_123'))

      expect(result.handled).toBe(true)
      expect(result.action).toBe('usage_reset')
      expect(deps.usageStore.resetMonthlyUsage).toHaveBeenCalledWith('tenant-1')
    })

    it('returns not handled when customer not found', async () => {
      const deps = createMockDeps()
      vi.mocked(deps.tenantStore.findTenantByStripeCustomerId).mockResolvedValue(null)
      const handler = createWebhookHandler(deps)

      const result = await handler.handleEvent(makeEvent('invoice.payment_succeeded', 'cus_unknown'))

      expect(result.handled).toBe(false)
      expect(result.action).toBe('tenant_not_found')
    })
  })

  describe('invoice.payment_failed', () => {
    it('schedules 3-day grace period agent suspension', async () => {
      const deps = createMockDeps()
      const handler = createWebhookHandler(deps)

      const result = await handler.handleEvent(makeEvent('invoice.payment_failed', 'cus_123'))

      expect(result.handled).toBe(true)
      expect(result.action).toContain('grace_period_scheduled')
      expect(deps.gracePeriod.scheduleAgentSuspension).toHaveBeenCalledWith('tenant-1', { delayDays: 3 })
    })
  })

  describe('customer.subscription.deleted', () => {
    it('suspends all agents and schedules 30-day data deletion', async () => {
      const deps = createMockDeps()
      const handler = createWebhookHandler(deps)

      const result = await handler.handleEvent(makeEvent('customer.subscription.deleted', 'cus_123'))

      expect(result.handled).toBe(true)
      expect(deps.agentManager.suspendAllAgents).toHaveBeenCalledWith('tenant-1')
      expect(deps.dataRetention.scheduleDataDeletion).toHaveBeenCalledWith('tenant-1', { days: 30 })
    })

    it('resets tenant subscription fields', async () => {
      const deps = createMockDeps()
      const handler = createWebhookHandler(deps)

      await handler.handleEvent(makeEvent('customer.subscription.deleted', 'cus_123'))

      expect(deps.tenantStore.updateTenant).toHaveBeenCalledWith('tenant-1', {
        stripeSubscriptionId: null,
        plan: 'starter',
      })
    })
  })

  describe('customer.subscription.updated', () => {
    it('syncs plan upgrade (growth -> scale)', async () => {
      const deps = createMockDeps()
      const handler = createWebhookHandler(deps)

      const result = await handler.handleEvent(
        makeEvent('customer.subscription.updated', 'cus_123', { plan: 'scale' }),
      )

      expect(result.handled).toBe(true)
      expect(result.action).toContain('growth->scale')
      expect(deps.tenantStore.updateTenant).toHaveBeenCalledWith('tenant-1', { plan: 'scale' })
    })

    it('suspends excess agents on downgrade (growth -> starter)', async () => {
      const deps = createMockDeps()
      const handler = createWebhookHandler(deps)

      const result = await handler.handleEvent(
        makeEvent('customer.subscription.updated', 'cus_123', { plan: 'starter' }),
      )

      expect(result.handled).toBe(true)
      expect(deps.agentManager.suspendAgents).toHaveBeenCalledWith(
        'tenant-1',
        ['ads-optimizer', 'inventory-guard', 'content-writer', 'market-intel'],
      )
    })

    it('returns no_change when plan is the same', async () => {
      const deps = createMockDeps()
      const handler = createWebhookHandler(deps)

      const result = await handler.handleEvent(
        makeEvent('customer.subscription.updated', 'cus_123', { plan: 'growth' }),
      )

      expect(result.handled).toBe(true)
      expect(result.action).toBe('no_change')
    })

    it('returns not handled when no plan in metadata', async () => {
      const deps = createMockDeps()
      const handler = createWebhookHandler(deps)

      const result = await handler.handleEvent(
        makeEvent('customer.subscription.updated', 'cus_123'),
      )

      expect(result.handled).toBe(false)
      expect(result.action).toBe('no_plan_in_metadata')
    })
  })
})

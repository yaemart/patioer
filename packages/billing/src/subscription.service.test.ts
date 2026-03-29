import { describe, expect, it, vi } from 'vitest'
import { createSubscriptionService } from './subscription.service.js'
import type { SubscriptionDeps } from './subscription.service.js'

function createMockDeps(): SubscriptionDeps {
  return {
    stripe: {
      customers: {
        create: vi.fn().mockResolvedValue({ id: 'cus_test123' }),
      },
      subscriptions: {
        create: vi.fn().mockResolvedValue({ id: 'sub_test456', status: 'trialing' }),
        update: vi.fn().mockResolvedValue({ id: 'sub_test456', status: 'active' }),
        cancel: vi.fn().mockResolvedValue({ id: 'sub_test456', status: 'canceled' }),
      },
    },
    tenantStore: {
      getTenant: vi.fn().mockResolvedValue({
        id: 'tenant-1',
        plan: 'starter',
        stripeCustomerId: 'cus_test123',
        stripeSubscriptionId: 'sub_test456',
      }),
      updateTenant: vi.fn().mockResolvedValue(undefined),
    },
    agentManager: {
      suspendAllAgents: vi.fn().mockResolvedValue(3),
      suspendAgents: vi.fn().mockResolvedValue(2),
      getActiveAgentIds: vi.fn().mockResolvedValue([
        'product-scout', 'price-sentinel', 'support-relay',
        'ads-optimizer', 'inventory-guard', 'content-writer', 'market-intel',
      ]),
    },
    retentionScheduler: {
      scheduleDataDeletion: vi.fn().mockResolvedValue(undefined),
    },
  }
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001'

describe('subscription.service', () => {
  describe('createSubscription', () => {
    it('creates Stripe customer and subscription with 14-day trial', async () => {
      const deps = createMockDeps()
      const service = createSubscriptionService(deps)

      const result = await service.createSubscription(TENANT_ID, 'starter', 'test@example.com')

      expect(result.customerId).toBe('cus_test123')
      expect(result.subscriptionId).toBe('sub_test456')
      expect(deps.stripe.customers.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        metadata: { tenantId: TENANT_ID },
      })
      expect(deps.stripe.subscriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_test123',
          trial_period_days: 14,
        }),
      )
    })

    it('updates tenant with stripe IDs and plan', async () => {
      const deps = createMockDeps()
      const service = createSubscriptionService(deps)

      await service.createSubscription(TENANT_ID, 'growth')

      expect(deps.tenantStore.updateTenant).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          stripeCustomerId: 'cus_test123',
          stripeSubscriptionId: 'sub_test456',
          plan: 'growth',
        }),
      )
    })

    it('uses correct price ID for each plan', async () => {
      const deps = createMockDeps()
      const service = createSubscriptionService(deps)

      await service.createSubscription(TENANT_ID, 'scale')

      expect(deps.stripe.subscriptions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [{ price: expect.stringContaining('PLACEHOLDER') }],
        }),
      )
    })
  })

  describe('upgradePlan', () => {
    it('updates Stripe subscription with proration', async () => {
      const deps = createMockDeps()
      const service = createSubscriptionService(deps)

      await service.upgradePlan(TENANT_ID, 'scale')

      expect(deps.stripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_test456',
        expect.objectContaining({
          proration_behavior: 'create_prorations',
        }),
      )
    })

    it('updates tenant plan', async () => {
      const deps = createMockDeps()
      const service = createSubscriptionService(deps)

      await service.upgradePlan(TENANT_ID, 'growth')

      expect(deps.tenantStore.updateTenant).toHaveBeenCalledWith(TENANT_ID, { plan: 'growth' })
    })

    it('throws if tenant has no subscription', async () => {
      const deps = createMockDeps()
      vi.mocked(deps.tenantStore.getTenant).mockResolvedValue({
        id: TENANT_ID,
        plan: 'starter',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      })
      const service = createSubscriptionService(deps)

      await expect(service.upgradePlan(TENANT_ID, 'growth')).rejects.toThrow('no active subscription')
    })
  })

  describe('downgradePlan', () => {
    it('suspends agents that exceed new plan limits', async () => {
      const deps = createMockDeps()
      const service = createSubscriptionService(deps)

      const result = await service.downgradePlan(TENANT_ID, 'starter')

      expect(result.suspendedAgents).toEqual([
        'ads-optimizer', 'inventory-guard', 'content-writer', 'market-intel',
      ])
      expect(deps.agentManager.suspendAgents).toHaveBeenCalledWith(
        TENANT_ID,
        ['ads-optimizer', 'inventory-guard', 'content-writer', 'market-intel'],
      )
    })

    it('does not suspend agents if all are within new plan limits', async () => {
      const deps = createMockDeps()
      vi.mocked(deps.agentManager.getActiveAgentIds).mockResolvedValue([
        'product-scout', 'price-sentinel', 'support-relay',
      ])
      const service = createSubscriptionService(deps)

      const result = await service.downgradePlan(TENANT_ID, 'starter')

      expect(result.suspendedAgents).toEqual([])
      expect(deps.agentManager.suspendAgents).not.toHaveBeenCalled()
    })

    it('updates Stripe subscription and tenant plan', async () => {
      const deps = createMockDeps()
      const service = createSubscriptionService(deps)

      await service.downgradePlan(TENANT_ID, 'starter')

      expect(deps.stripe.subscriptions.update).toHaveBeenCalled()
      expect(deps.tenantStore.updateTenant).toHaveBeenCalledWith(TENANT_ID, { plan: 'starter' })
    })
  })

  describe('cancelSubscription', () => {
    it('cancels Stripe subscription', async () => {
      const deps = createMockDeps()
      const service = createSubscriptionService(deps)

      await service.cancelSubscription(TENANT_ID)

      expect(deps.stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_test456')
    })

    it('suspends all agents', async () => {
      const deps = createMockDeps()
      const service = createSubscriptionService(deps)

      await service.cancelSubscription(TENANT_ID)

      expect(deps.agentManager.suspendAllAgents).toHaveBeenCalledWith(TENANT_ID)
    })

    it('schedules 30-day data deletion', async () => {
      const deps = createMockDeps()
      const service = createSubscriptionService(deps)

      await service.cancelSubscription(TENANT_ID)

      expect(deps.retentionScheduler.scheduleDataDeletion).toHaveBeenCalledWith(TENANT_ID, { days: 30 })
    })

    it('resets tenant subscription fields', async () => {
      const deps = createMockDeps()
      const service = createSubscriptionService(deps)

      await service.cancelSubscription(TENANT_ID)

      expect(deps.tenantStore.updateTenant).toHaveBeenCalledWith(TENANT_ID, {
        stripeSubscriptionId: null,
        plan: 'starter',
      })
    })

    it('throws if tenant has no subscription', async () => {
      const deps = createMockDeps()
      vi.mocked(deps.tenantStore.getTenant).mockResolvedValue({
        id: TENANT_ID, plan: 'starter', stripeCustomerId: null, stripeSubscriptionId: null,
      })
      const service = createSubscriptionService(deps)

      await expect(service.cancelSubscription(TENANT_ID)).rejects.toThrow('no active subscription')
    })
  })
})

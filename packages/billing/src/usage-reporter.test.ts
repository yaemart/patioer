import { describe, expect, it, vi } from 'vitest'
import { createUsageReporter } from './usage-reporter.js'
import type { UsageReporterDeps } from './usage-reporter.js'

function createMockDeps(monthlyUsage = 0): UsageReporterDeps {
  return {
    stripeMeter: {
      createMeterEvent: vi.fn().mockResolvedValue(undefined),
    },
    usageStore: {
      getMonthlyUsageUsd: vi.fn().mockResolvedValue(monthlyUsage),
      recordUsage: vi.fn().mockResolvedValue(undefined),
    },
    eventLake: {
      record: vi.fn().mockResolvedValue(undefined),
    },
  }
}

const TENANT_ID = 'tenant-1'
const STRIPE_CUSTOMER_ID = 'cus_test123'

describe('usage-reporter', () => {
  it('does not report to Stripe when within budget (starter: $160)', async () => {
    const deps = createMockDeps(100)
    const reporter = createUsageReporter(deps)

    const event = await reporter.reportTokenUsage(
      TENANT_ID, STRIPE_CUSTOMER_ID, 'starter', 'product-scout', 1000, 'gpt-4o',
    )

    expect(event.isOverage).toBe(false)
    expect(event.reportedToStripe).toBe(false)
    expect(deps.stripeMeter.createMeterEvent).not.toHaveBeenCalled()
  })

  it('reports to Stripe Meter when over budget', async () => {
    const deps = createMockDeps(160)
    const reporter = createUsageReporter(deps)

    const event = await reporter.reportTokenUsage(
      TENANT_ID, STRIPE_CUSTOMER_ID, 'starter', 'product-scout', 5000, 'gpt-4o',
    )

    expect(event.isOverage).toBe(true)
    expect(event.reportedToStripe).toBe(true)
    expect(deps.stripeMeter.createMeterEvent).toHaveBeenCalledWith({
      event_name: 'agent_token_usage',
      payload: {
        stripe_customer_id: STRIPE_CUSTOMER_ID,
        value: '5000',
      },
    })
  })

  it('always writes to ClickHouse event lake', async () => {
    const deps = createMockDeps(0)
    const reporter = createUsageReporter(deps)

    await reporter.reportTokenUsage(
      TENANT_ID, STRIPE_CUSTOMER_ID, 'growth', 'ads-optimizer', 2000, 'gpt-4o-mini',
    )

    expect(deps.eventLake.record).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      eventType: 'token_usage',
      payload: expect.objectContaining({
        agentId: 'ads-optimizer',
        tokensUsed: 2000,
      }),
    })
  })

  it('always records to usage store', async () => {
    const deps = createMockDeps(0)
    const reporter = createUsageReporter(deps)

    await reporter.reportTokenUsage(
      TENANT_ID, STRIPE_CUSTOMER_ID, 'scale', 'finance-agent', 3000, 'gpt-4o',
    )

    expect(deps.usageStore.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        agentId: 'finance-agent',
        tokensUsed: 3000,
      }),
    )
  })

  it('uses growth plan budget ($500) for overage check', async () => {
    const deps = createMockDeps(499)
    const reporter = createUsageReporter(deps)

    const event = await reporter.reportTokenUsage(
      TENANT_ID, STRIPE_CUSTOMER_ID, 'growth', 'product-scout', 500000, 'gpt-4o',
    )

    expect(event.isOverage).toBe(true)
  })

  it('uses scale plan budget ($1200) for overage check', async () => {
    const deps = createMockDeps(1100)
    const reporter = createUsageReporter(deps)

    const event = await reporter.reportTokenUsage(
      TENANT_ID, STRIPE_CUSTOMER_ID, 'scale', 'ceo-agent', 1000, 'gpt-4o',
    )

    expect(event.isOverage).toBe(false)
  })

  it('calculates cost correctly (1000 tokens = $0.003)', async () => {
    const deps = createMockDeps(0)
    const reporter = createUsageReporter(deps)

    const event = await reporter.reportTokenUsage(
      TENANT_ID, STRIPE_CUSTOMER_ID, 'starter', 'product-scout', 10000, 'gpt-4o',
    )

    expect(event.costUsd).toBeCloseTo(0.03)
  })
})

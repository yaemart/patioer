import { describe, expect, it, vi } from 'vitest'
import { createReconciliationService } from './reconciliation.js'
import type { ReconciliationDeps } from './reconciliation.js'

const NOW = new Date('2026-04-01T00:00:00Z')
const PERIOD_START = new Date('2026-03-01T00:00:00Z')
const PERIOD_END = new Date('2026-03-31T23:59:59Z')

function createMockDeps(stripeAmountCents: number, calculatedUsageUsd: number): ReconciliationDeps {
  return {
    stripeInvoices: {
      listRecentInvoices: vi.fn().mockResolvedValue([{
        customerId: 'cus_123',
        amountCents: stripeAmountCents,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }]),
    },
    usageStore: {
      getUsageForPeriod: vi.fn().mockResolvedValue(calculatedUsageUsd),
    },
    tenantStore: {
      findTenantByStripeCustomerId: vi.fn().mockResolvedValue({ id: 'tenant-1' }),
    },
    resultStore: {
      save: vi.fn().mockResolvedValue(undefined),
    },
    alertSystem: {
      createTicket: vi.fn().mockResolvedValue(undefined),
    },
  }
}

describe('reconciliation', () => {
  it('returns ok when amounts match exactly', async () => {
    const deps = createMockDeps(10000, 100)
    const service = createReconciliationService(deps)

    const results = await service.reconcile(NOW)

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].diffCents).toBe(0)
  })

  it('returns ok when diff is within 1% threshold', async () => {
    const deps = createMockDeps(10000, 100.05)
    const service = createReconciliationService(deps)

    const results = await service.reconcile(NOW)

    expect(results[0].status).toBe('ok')
  })

  it('returns mismatch when diff exceeds 1% but under $1', async () => {
    const deps = createMockDeps(1000, 10.50)
    const service = createReconciliationService(deps)

    const results = await service.reconcile(NOW)

    expect(results[0].status).toBe('mismatch')
    expect(deps.alertSystem.createTicket).not.toHaveBeenCalled()
  })

  it('creates P2 alert ticket when diff exceeds $1', async () => {
    const deps = createMockDeps(50000, 520)
    const service = createReconciliationService(deps)

    const results = await service.reconcile(NOW)

    expect(results[0].status).toBe('alert')
    expect(deps.alertSystem.createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        type: 'billing_reconciliation',
        priority: 'P2',
      }),
    )
  })

  it('saves all reconciliation records', async () => {
    const deps = createMockDeps(10000, 100)
    const service = createReconciliationService(deps)

    await service.reconcile(NOW)

    expect(deps.resultStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
    )
  })

  it('skips invoices for unknown customers', async () => {
    const deps = createMockDeps(10000, 100)
    vi.mocked(deps.tenantStore.findTenantByStripeCustomerId).mockResolvedValue(null)
    const service = createReconciliationService(deps)

    const results = await service.reconcile(NOW)

    expect(results).toHaveLength(0)
    expect(deps.resultStore.save).not.toHaveBeenCalled()
  })
})

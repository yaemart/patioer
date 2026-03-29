export interface ReconciliationRecord {
  tenantId: string
  periodStart: Date
  periodEnd: Date
  stripeAmountCents: number
  calculatedAmountCents: number
  diffCents: number
  status: 'ok' | 'mismatch' | 'alert'
}

export interface StripeInvoiceClient {
  listRecentInvoices(since: Date): Promise<Array<{
    customerId: string
    amountCents: number
    periodStart: Date
    periodEnd: Date
  }>>
}

export interface ReconciliationUsageStore {
  getUsageForPeriod(tenantId: string, start: Date, end: Date): Promise<number>
}

export interface ReconciliationTenantStore {
  findTenantByStripeCustomerId(customerId: string): Promise<{ id: string } | null>
}

export interface ReconciliationResultStore {
  save(record: ReconciliationRecord): Promise<void>
}

export interface AlertSystem {
  createTicket(params: { tenantId: string; type: string; priority: string; title: string; description: string }): Promise<void>
}

export interface ReconciliationDeps {
  stripeInvoices: StripeInvoiceClient
  usageStore: ReconciliationUsageStore
  tenantStore: ReconciliationTenantStore
  resultStore: ReconciliationResultStore
  alertSystem: AlertSystem
}

const MISMATCH_THRESHOLD_PERCENT = 1

export function createReconciliationService(deps: ReconciliationDeps) {
  const { stripeInvoices, usageStore, tenantStore, resultStore, alertSystem } = deps

  async function reconcile(since: Date): Promise<ReconciliationRecord[]> {
    const invoices = await stripeInvoices.listRecentInvoices(since)
    const results: ReconciliationRecord[] = []

    for (const invoice of invoices) {
      const tenant = await tenantStore.findTenantByStripeCustomerId(invoice.customerId)
      if (!tenant) continue

      const calculatedCents = Math.round(
        await usageStore.getUsageForPeriod(tenant.id, invoice.periodStart, invoice.periodEnd) * 100,
      )

      const diffCents = Math.abs(invoice.amountCents - calculatedCents)
      const diffPercent = invoice.amountCents > 0
        ? (diffCents / invoice.amountCents) * 100
        : (calculatedCents > 0 ? 100 : 0)

      let status: ReconciliationRecord['status'] = 'ok'
      if (diffPercent > MISMATCH_THRESHOLD_PERCENT) {
        status = 'mismatch'
        if (diffCents > 100) {
          status = 'alert'
          await alertSystem.createTicket({
            tenantId: tenant.id,
            type: 'billing_reconciliation',
            priority: 'P2',
            title: `Billing reconciliation mismatch: $${(diffCents / 100).toFixed(2)} diff`,
            description: `Stripe: $${(invoice.amountCents / 100).toFixed(2)}, Calculated: $${(calculatedCents / 100).toFixed(2)}`,
          })
        }
      }

      const record: ReconciliationRecord = {
        tenantId: tenant.id,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        stripeAmountCents: invoice.amountCents,
        calculatedAmountCents: calculatedCents,
        diffCents,
        status,
      }

      await resultStore.save(record)
      results.push(record)
    }

    return results
  }

  return { reconcile }
}

export type ReconciliationService = ReturnType<typeof createReconciliationService>

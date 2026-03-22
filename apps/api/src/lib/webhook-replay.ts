import { and, eq, lt } from 'drizzle-orm'
import { db, withTenantDb, schema } from '@patioer/db'
import { markWebhookProcessed, markWebhookFailed } from './webhook-dedup.js'

export interface ReplayResult {
  total: number
  processed: number
  failed: number
}

const DEFAULT_RETRY_AFTER_MS = 60_000
const DEFAULT_LIMIT = 100

export async function replayPendingWebhooks(
  handler: (topic: string, tenantId: string, payload: unknown) => Promise<void>,
  options?: { retryAfterMs?: number; limit?: number },
): Promise<ReplayResult> {
  const retryAfterMs = options?.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS
  const limit = options?.limit ?? DEFAULT_LIMIT
  const cutoff = new Date(Date.now() - retryAfterMs)

  // tenants has no RLS (intentionally excluded — see migration ADR-0001).
  // Enumerate all tenants so we can query webhook_events within each tenant's
  // RLS context instead of bypassing it with the global db connection.
  const allTenants = await db.select({ id: schema.tenants.id }).from(schema.tenants)

  const result: ReplayResult = { total: 0, processed: 0, failed: 0 }

  for (const tenant of allTenants) {
    const remaining = limit - result.total
    if (remaining <= 0) break

    const pending = await withTenantDb(tenant.id, (tdb) =>
      tdb
        .select({
          id: schema.webhookEvents.id,
          tenantId: schema.webhookEvents.tenantId,
          topic: schema.webhookEvents.topic,
          payload: schema.webhookEvents.payload,
        })
        .from(schema.webhookEvents)
        .where(
          and(
            eq(schema.webhookEvents.status, 'received'),
            lt(schema.webhookEvents.receivedAt, cutoff),
          ),
        )
        .limit(remaining),
    )

    result.total += pending.length

    for (const event of pending) {
      try {
        await handler(event.topic, event.tenantId, event.payload)
      } catch (err) {
        await withTenantDb(tenant.id, (tdb) =>
          markWebhookFailed(tdb, event.id, err instanceof Error ? err.message : String(err)),
        )
        result.failed += 1
        continue
      }

      try {
        await withTenantDb(tenant.id, (tdb) => markWebhookProcessed(tdb, event.id))
        result.processed += 1
      } catch {
        // Handler side effects already succeeded; do not overwrite webhook state to `failed`.
        result.failed += 1
      }
    }
  }

  return result
}

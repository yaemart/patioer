import { and, inArray, lt } from 'drizzle-orm'
import { listTenantIds, withTenantDb, schema } from '@patioer/db'
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

  const tenantIds = await listTenantIds()

  const result: ReplayResult = { total: 0, processed: 0, failed: 0 }

  for (const tenantId of tenantIds) {
    const remaining = limit - result.total
    if (remaining <= 0) break

    const pending = await withTenantDb(tenantId, (tdb) =>
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
            inArray(schema.webhookEvents.status, ['received', 'received_live']),
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
        await withTenantDb(tenantId, (tdb) =>
          markWebhookFailed(tdb, event.id, err instanceof Error ? err.message : String(err)),
        )
        result.failed += 1
        continue
      }

      try {
        await withTenantDb(tenantId, (tdb) => markWebhookProcessed(tdb, event.id))
        result.processed += 1
      } catch {
        // Handler side effects already succeeded; do not overwrite webhook state to `failed`.
        result.failed += 1
      }
    }
  }

  return result
}

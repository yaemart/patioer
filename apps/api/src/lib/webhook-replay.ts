import { and, inArray, lt } from 'drizzle-orm'
import { listTenantIds, withTenantDb, schema } from '@patioer/db'
import { markWebhookProcessed, markWebhookFailed } from './webhook-dedup.js'
import {
  dispatchWebhook,
  handleWebhookTopic,
  type WebhookPlatform,
  type WebhookTopic,
} from './webhook-topic-handler.js'

export interface ReplayResult {
  total: number
  processed: number
  failed: number
}

const DEFAULT_RETRY_AFTER_MS = 60_000
const DEFAULT_LIMIT = 100

export async function replayPendingWebhooks(
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
          platform: schema.webhookEvents.platform,
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
        await replayOneEvent(event)
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
        result.failed += 1
      }
    }
  }

  return result
}

async function replayOneEvent(event: {
  tenantId: string
  platform: string
  topic: string
  payload: unknown
}): Promise<void> {
  if (event.platform === 'shopify') {
    await handleWebhookTopic(event.topic, event.tenantId, event.payload)
    return
  }
  await dispatchWebhook({
    platform: event.platform as WebhookPlatform,
    topic: event.topic as WebhookTopic,
    tenantId: event.tenantId,
    payload: event.payload,
    receivedAt: new Date(),
  })
}

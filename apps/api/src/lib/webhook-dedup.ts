import { eq } from 'drizzle-orm'
import type { AppDb } from '@patioer/db'
import { schema } from '@patioer/db'

export interface WebhookMeta {
  webhookId: string
  topic: string
  shopDomain: string
  tenantId: string
}

export async function recordWebhookIfNew(
  db: AppDb,
  meta: WebhookMeta,
  payload: unknown,
): Promise<{ duplicate: boolean; eventId?: string }> {
  // Use INSERT ... ON CONFLICT DO NOTHING ... RETURNING instead of SELECT + INSERT.
  // The SELECT→INSERT pattern has a TOCTOU race: two concurrent requests with the
  // same webhookId can both pass the SELECT check and then race to INSERT, causing
  // the second to fail with a unique constraint violation.
  // The atomic single-statement approach eliminates the race entirely: the DB
  // unique index on (tenantId, webhookId) acts as the dedup gate and returns an
  // empty array when a conflict occurs, which we map to `duplicate: true`.
  const rows = await db
    .insert(schema.webhookEvents)
    .values({
      tenantId: meta.tenantId,
      webhookId: meta.webhookId,
      topic: meta.topic,
      shopDomain: meta.shopDomain,
      payload: payload as Record<string, unknown>,
      status: 'received',
    })
    .onConflictDoNothing()
    .returning({ id: schema.webhookEvents.id })

  if (rows.length === 0) {
    return { duplicate: true }
  }

  return { duplicate: false, eventId: rows[0]!.id }
}

export async function markWebhookProcessed(db: AppDb, eventId: string): Promise<void> {
  await db
    .update(schema.webhookEvents)
    .set({ status: 'processed', processedAt: new Date() })
    .where(eq(schema.webhookEvents.id, eventId))
}

export async function markWebhookFailed(
  db: AppDb,
  eventId: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(schema.webhookEvents)
    .set({ status: 'failed', errorMessage })
    .where(eq(schema.webhookEvents.id, eventId))
}

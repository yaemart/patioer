import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id:           uuid('id').defaultRandom().primaryKey(),
    tenantId:     uuid('tenant_id').notNull().references(() => tenants.id),
    platform:     text('platform').notNull().default('shopify'),
    webhookId:    text('webhook_id').notNull(),
    topic:        text('topic').notNull(),
    shopDomain:   text('shop_domain'),
    payload:      jsonb('payload').notNull(),
    status:       text('status').notNull().default('received'),
    errorMessage: text('error_message'),
    processedAt:  timestamp('processed_at', { withTimezone: true }),
    receivedAt:   timestamp('received_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('webhook_events_tenant_webhook_id_idx').on(t.tenantId, t.webhookId),
  ],
)

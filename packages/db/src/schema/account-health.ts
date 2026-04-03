import {
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const accountHealthEvents = pgTable(
  'account_health_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    platform: text('platform').notNull(),
    eventType: text('event_type').notNull(),
    severity: text('severity').notNull().default('warning'),
    title: text('title').notNull(),
    description: text('description'),
    affectedEntity: text('affected_entity'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
)

export type AccountHealthEvent = typeof accountHealthEvents.$inferSelect
export type NewAccountHealthEvent = typeof accountHealthEvents.$inferInsert

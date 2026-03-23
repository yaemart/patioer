import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

/** ElectroOS 侧记录的 DevOS Ticket 同步行（租户可空 = 系统级）。 */
export const devosTickets = pgTable('devos_tickets', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  type: text('type').notNull(),
  priority: text('priority').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  context: jsonb('context'),
  status: text('status').notNull().default('open'),
  devosTicketId: text('devos_ticket_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})

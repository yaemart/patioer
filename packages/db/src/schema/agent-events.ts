import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { agents } from './agents.js'
import { tenants } from './tenants.js'

export const agentEvents = pgTable('agent_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id),
  action: text('action').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

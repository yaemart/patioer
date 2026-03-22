import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const agentTypeEnum = pgEnum('agent_type', [
  'product-scout',
  'price-sentinel',
  'support-relay',
  'ads-optimizer',
  'inventory-guard',
])

export const agentStatusEnum = pgEnum('agent_status', [
  'active',
  'suspended',
  'error',
])

export const agents = pgTable('agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  type: agentTypeEnum('type').notNull(),
  status: agentStatusEnum('status').notNull().default('active'),
  goalContext: text('goal_context'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

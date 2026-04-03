import {
  boolean,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const serviceCases = pgTable(
  'service_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    platform: text('platform').notNull(),
    caseType: text('case_type').notNull(),
    orderId: text('order_id'),
    productId: text('product_id'),
    status: text('status').notNull().default('open'),
    amount: numeric('amount', { precision: 10, scale: 2 }),
    customerMessage: text('customer_message'),
    agentResponse: text('agent_response'),
    escalated: boolean('escalated').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
)

export type ServiceCase = typeof serviceCases.$inferSelect
export type NewServiceCase = typeof serviceCases.$inferInsert

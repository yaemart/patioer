import {
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.js'

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    platformOrderId: text('platform_order_id').notNull(),
    platform: text('platform').notNull(),
    status: text('status').notNull(),
    items: jsonb('items'),
    totalPrice: numeric('total_price', { precision: 10, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('orders_tenant_platform_order_idx').on(
      t.tenantId,
      t.platform,
      t.platformOrderId,
    ),
  ],
)

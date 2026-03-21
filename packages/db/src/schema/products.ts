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

export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    platformProductId: text('platform_product_id').notNull(),
    platform: text('platform').notNull(),
    title: text('title').notNull(),
    category: text('category'),
    price: numeric('price', { precision: 10, scale: 2 }),
    attributes: jsonb('attributes'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('products_tenant_platform_product_idx').on(
      t.tenantId,
      t.platform,
      t.platformProductId,
    ),
  ],
)

import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { products } from './products.js'
import { tenants } from './tenants.js'

/** Per-store inventory snapshot for a catalog product (Phase 2 · Sprint 4). Aligns with `docs/plans/phase2-plan.md` §4.3. */
export const inventoryLevels = pgTable(
  'inventory_levels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    platform: text('platform').notNull(),
    quantity: integer('quantity').notNull().default(0),
    safetyThreshold: integer('safety_threshold').default(10),
    /** `normal` | `low` | `out_of_stock` */
    status: text('status').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('inventory_levels_tenant_product_platform_idx').on(
      t.tenantId,
      t.productId,
      t.platform,
    ),
  ],
)

export type InventoryLevel = typeof inventoryLevels.$inferSelect
export type NewInventoryLevel = typeof inventoryLevels.$inferInsert
